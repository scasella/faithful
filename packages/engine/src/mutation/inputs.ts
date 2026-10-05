/**
 * Second-pass inputs for the mutation tester: more inputs, and larger ones, than the differential set, drawn by type
 * (the function's declared parameter types, read with the TypeScript checker) with magnitudes taken from the given
 * inputs and widened. Deterministic given the seed.
 *
 * Widening rule (per position, e.g. `0`, `0[]`, `1.name`): an integer position whose observed values were all >= m >= 0
 * keeps that lower bound and widens upward to 2*max+4; a position that saw negatives widens both ways. Arrays and
 * strings get lengths up to 2*maxLength+4. Strings draw only characters already seen at that position (or `a`/`b` when
 * none were seen), so an ASCII-only or BMP-only input set stays that way. Generated inputs are NOT assumed valid: the
 * caller filters them through the preconditions and the range-instrumented original.
 */
import ts from 'typescript';
import type { Ty, Val } from '@faithful/translate';
import { randInt, type Rng } from '../benchmark/rng.js';
import { UNIT_FILE, findFunction, makeProgram } from './mutate.js';

interface Profile {
  min: number;
  max: number;
  seenInt: boolean;
  maxLen: number;
  chars: Set<string>;
}

type Profiles = Map<string, Profile>;

function prof(ps: Profiles, path: string): Profile {
  let p = ps.get(path);
  if (!p) {
    p = { min: Infinity, max: -Infinity, seenInt: false, maxLen: 0, chars: new Set() };
    ps.set(path, p);
  }
  return p;
}

function observe(ps: Profiles, ty: Ty, v: Val, path: string): void {
  const p = prof(ps, path);
  switch (ty.k) {
    case 'int':
      if (typeof v === 'number') {
        p.seenInt = true;
        p.min = Math.min(p.min, v);
        p.max = Math.max(p.max, v);
      }
      return;
    case 'string':
      if (typeof v === 'string') {
        p.maxLen = Math.max(p.maxLen, v.length);
        for (const c of v) p.chars.add(c);
      }
      return;
    case 'array':
      if (Array.isArray(v)) {
        p.maxLen = Math.max(p.maxLen, v.length);
        for (const x of v) observe(ps, ty.elem, x, `${path}[]`);
      }
      return;
    case 'tuple':
      if (Array.isArray(v)) ty.elems.forEach((t, i) => observe(ps, t, v[i] ?? null, `${path}[${i}]`));
      return;
    case 'record':
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const f of ty.fields) observe(ps, f.ty, (v as Record<string, Val>)[f.name] ?? null, `${path}.${f.name}`);
      }
      return;
    case 'option':
      if (v !== null) observe(ps, ty.inner, v, path);
      return;
    case 'bool':
      return;
  }
}

function genTy(ps: Profiles, ty: Ty, path: string, rng: Rng): Val {
  const p = ps.get(path);
  switch (ty.k) {
    case 'int': {
      if (!p || !p.seenInt) return randInt(rng, -8, 8);
      const lo = p.min >= 0 ? p.min : 2 * p.min - 4;
      const hi = p.max <= 0 && p.min < 0 ? p.max : 2 * Math.max(p.max, 0) + 4;
      return randInt(rng, lo, Math.max(lo, hi));
    }
    case 'bool':
      return rng() < 0.5;
    case 'string': {
      const pool = p && p.chars.size > 0 ? [...p.chars].sort() : ['a', 'b'];
      const n = randInt(rng, 0, 2 * (p?.maxLen ?? 2) + 4);
      let s = '';
      for (let i = 0; i < n; i++) s += pool[randInt(rng, 0, pool.length - 1)]!;
      return s;
    }
    case 'array': {
      const n = randInt(rng, 0, 2 * (p?.maxLen ?? 2) + 4);
      const out: Val[] = [];
      for (let i = 0; i < n; i++) out.push(genTy(ps, ty.elem, `${path}[]`, rng));
      return out;
    }
    case 'tuple':
      return ty.elems.map((t, i) => genTy(ps, t, `${path}[${i}]`, rng));
    case 'record': {
      const o: Record<string, Val> = {};
      for (const f of ty.fields) o[f.name] = genTy(ps, f.ty, `${path}.${f.name}`, rng);
      return o;
    }
    case 'option':
      return rng() < 0.2 ? null : genTy(ps, ty.inner, path, rng);
  }
}

/** Generator of `count` argument lists by parameter type, widened from the magnitudes seen in `templates`. */
export function deriveInputs(tys: Ty[], templates: Val[][], count: number, rng: Rng): Val[][] {
  const ps: Profiles = new Map();
  for (const args of templates) tys.forEach((t, i) => observe(ps, t, args[i] ?? null, `${i}`));
  const out: Val[][] = [];
  for (let n = 0; n < count; n++) out.push(tys.map((t, i) => genTy(ps, t, `${i}`, rng)));
  return out;
}

// ───────────────────────── parameter types from the source ─────────────────────────

function tyOf(checker: ts.TypeChecker, t: ts.Type, depth: number): Ty | null {
  if (depth > 12) return null;
  const f = t.flags;
  if (f & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) return { k: 'int' };
  if (f & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return { k: 'bool' };
  if (f & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) return { k: 'string' };
  if (t.isUnion()) {
    const parts = t.types.filter((x) => !(x.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
    if (parts.every((x) => x.flags & ts.TypeFlags.BooleanLiteral)) {
      return parts.length === t.types.length ? { k: 'bool' } : { k: 'option', inner: { k: 'bool' } };
    }
    if (parts.length === 1) {
      const inner = tyOf(checker, parts[0]!, depth + 1);
      return inner ? { k: 'option', inner } : null;
    }
    return null;
  }
  if (checker.isTupleType(t)) {
    const elems = checker.getTypeArguments(t as ts.TypeReference).map((x) => tyOf(checker, x, depth + 1));
    return elems.every((x): x is Ty => x !== null) ? { k: 'tuple', elems } : null;
  }
  if (checker.isArrayType(t)) {
    const [el] = checker.getTypeArguments(t as ts.TypeReference);
    const elem = el ? tyOf(checker, el, depth + 1) : null;
    return elem ? { k: 'array', elem } : null;
  }
  if (f & ts.TypeFlags.Object) {
    if (checker.getIndexInfosOfType(t).length > 0 || t.getCallSignatures().length > 0) return null;
    const fields: Array<{ name: string; ty: Ty }> = [];
    for (const s of checker.getPropertiesOfType(t)) {
      const d = s.valueDeclaration ?? s.declarations?.[0];
      if (!d) return null;
      const ft = tyOf(checker, checker.getTypeOfSymbolAtLocation(s, d), depth + 1);
      if (!ft) return null;
      fields.push({ name: s.name, ty: ft });
    }
    return { k: 'record', fields };
  }
  return null;
}

/** Declared parameter types of `fnName` as subset `Ty`s, or null when one is outside what this generator can draw. */
export function paramTys(source: string, fnName: string): Ty[] | null {
  const program = makeProgram(source);
  const sf = program.getSourceFile(UNIT_FILE);
  if (!sf) return null;
  const fn = findFunction(sf, fnName);
  if (!fn) return null;
  const checker = program.getTypeChecker();
  const out: Ty[] = [];
  for (const p of fn.parameters) {
    if (!p.type || p.dotDotDotToken) return null;
    const t = tyOf(checker, checker.getTypeFromTypeNode(p.type), 0);
    if (!t) return null;
    out.push(t);
  }
  return out;
}
