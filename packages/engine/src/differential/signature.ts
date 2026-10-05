/**
 * Signature-based input generation for the Tested-only path: inputs for a function the translator REFUSED, drawn from its
 * declared TypeScript parameter types alone (read with the TypeScript checker). No translation, no Lean model, no
 * preconditions: the original function is the only reference, and every generated input is a legal call of it.
 *
 * Types that can be generated (`STy`):
 *   number   a mix of integers (zero, units, negatives, 32-bit and 2^53 edges, beyond 2^53) AND non-integer finite doubles
 *            (halves, 0.1/0.2/0.3, 1/3, tiny and huge magnitudes, Number.MAX_VALUE, the smallest subnormal). NaN,
 *            Infinity, -Infinity and -0 are generated ONLY when the caller opts in (`specials: true`), as a labeled
 *            boundary set (counted in `specialInputs`), never silently;
 *   string   ASCII, non-ASCII BMP text, and astral characters (no BMP restriction outside the model);
 *   boolean, string/number/boolean literal unions, arrays (also readonly), tuples (fixed length), plain object types
 *            (interfaces, aliases, inline; optional fields are sometimes omitted), and `T | null` / `T | undefined` /
 *            optional parameters.
 * Refused, with a plain-words reason (`inferSignature` returns `{ ok: false }`): generic functions, rest parameters,
 * parameters that are functions, class instances and objects with methods (Date, Map, Set, RegExp, Promise ...),
 * `any` / `unknown` / missing annotations, index signatures (dictionaries), unions of several non-literal types,
 * intersections, enums, bigint and symbol, recursive types, and a field named `$faithful` (the sentinel key).
 *
 * Generation is deterministic and seeded (mulberry32, as in generate.ts): boundary combinations first (diagonal walks
 * over each parameter's boundary list, at most a third of `n`), then random values; duplicates (by JSON text, sentinels
 * included, so -0 and 0 are distinct inputs) are dropped. Same (signature, options) => same inputs on every machine.
 * Values are JSON `Val`s with the sentinels of jsvalues.ts; load the function with `values: 'js'` to run them.
 */
import ts from 'typescript';
import type { Val } from '@faithful/translate';
import { Rng } from './generate.js';
import { SENTINEL_KEY, containsNonInteger, containsSpecialNumber, special } from './jsvalues.js';
import { findFunction, makeProgram, UNIT_FILE } from '../mutation/mutate.js';

export type STy =
  | { k: 'number' }
  | { k: 'string' }
  | { k: 'boolean' }
  | { k: 'literal'; values: Array<string | number | boolean> }
  | { k: 'array'; elem: STy }
  | { k: 'tuple'; elems: STy[] }
  | { k: 'record'; fields: Array<{ name: string; ty: STy; optional: boolean }> }
  | { k: 'nullable'; inner: STy; nul: boolean; undef: boolean };

export interface SigParam {
  name: string;
  ty: STy;
  /** `x?: T` or `x = default`: the generator sometimes passes `undefined`. */
  optional: boolean;
}

export interface FunctionSignature {
  fnName: string;
  params: SigParam[];
}

export type SignatureResult = { ok: true; sig: FunctionSignature } | { ok: false; reason: string };

// ───────────────────────── inference ─────────────────────────

class Refuse extends Error {}

const BUILTIN_CLASSES = new Set(['Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Promise', 'Error', 'ArrayBuffer', 'DataView', 'Function', 'Symbol', 'BigInt']);

function tyOf(checker: ts.TypeChecker, t: ts.Type, where: string, depth: number, stack: Set<ts.Type>): STy {
  if (depth > 16 || stack.has(t)) throw new Refuse(`${where} has a recursive type; inputs of unbounded depth are not generated`);
  const f = t.flags;
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) throw new Refuse(`${where} is typed ${f & ts.TypeFlags.Any ? 'any (or has no annotation)' : 'unknown'}; there is no type to generate inputs from`);
  if (f & ts.TypeFlags.TypeParameter) throw new Refuse(`${where} has a generic type (${checker.typeToString(t)}); inputs cannot be generated without knowing it`);
  if (f & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) throw new Refuse(`${where} is a bigint; bigints are not generated`);
  if (f & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) throw new Refuse(`${where} is a symbol; symbols are not generated`);
  if (f & (ts.TypeFlags.Never | ts.TypeFlags.Void)) throw new Refuse(`${where} is typed ${checker.typeToString(t)}; no value of it can be passed`);
  if (f & ts.TypeFlags.EnumLike) throw new Refuse(`${where} is an enum; enums are not generated`);
  if (f & ts.TypeFlags.Intersection) throw new Refuse(`${where} is an intersection type (${checker.typeToString(t)}); not generated`);
  if (f & ts.TypeFlags.Number) return { k: 'number' };
  if (f & ts.TypeFlags.String) return { k: 'string' };
  if (f & ts.TypeFlags.Boolean) return { k: 'boolean' };
  if (f & ts.TypeFlags.NumberLiteral) return { k: 'literal', values: [(t as ts.NumberLiteralType).value] };
  if (f & ts.TypeFlags.StringLiteral) return { k: 'literal', values: [(t as ts.StringLiteralType).value] };
  if (f & ts.TypeFlags.BooleanLiteral) return { k: 'literal', values: [checker.typeToString(t) === 'true'] };
  if (f & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) return { k: 'nullable', inner: { k: 'literal', values: [] }, nul: !!(f & ts.TypeFlags.Null), undef: !!(f & ts.TypeFlags.Undefined) };
  if (t.isUnion()) {
    const nul = t.types.some((x) => x.flags & ts.TypeFlags.Null);
    const undef = t.types.some((x) => x.flags & ts.TypeFlags.Undefined);
    const rest = t.types.filter((x) => !(x.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
    let inner: STy;
    if (rest.length === 0) inner = { k: 'literal', values: [] };
    else if (rest.every((x) => x.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral))) {
      const values = rest.map((x) => (x.flags & ts.TypeFlags.BooleanLiteral ? checker.typeToString(x) === 'true' : (x as ts.LiteralType).value as string | number));
      inner = values.length === 2 && values.includes(true) && values.includes(false) ? { k: 'boolean' } : { k: 'literal', values };
    } else if (rest.length === 1) {
      stack.add(t);
      inner = tyOf(checker, rest[0]!, where, depth + 1, stack);
      stack.delete(t);
    } else {
      throw new Refuse(`${where} is a union of several types (${checker.typeToString(t)}); only literal unions and T | null | undefined are generated`);
    }
    return nul || undef ? { k: 'nullable', inner, nul, undef } : inner;
  }
  if (f & ts.TypeFlags.Object) {
    stack.add(t);
    try {
      if (checker.isTupleType(t)) {
        const target = (t as ts.TypeReference).target as ts.TupleType;
        if (target.elementFlags?.some((ef) => ef & (ts.ElementFlags.Optional | ts.ElementFlags.Rest | ts.ElementFlags.Variadic))) {
          throw new Refuse(`${where} is a tuple with optional or rest elements; only fixed-length tuples are generated`);
        }
        return { k: 'tuple', elems: checker.getTypeArguments(t as ts.TypeReference).map((x, i) => tyOf(checker, x, `${where}[${i}]`, depth + 1, stack)) };
      }
      if (checker.isArrayType(t)) {
        const [el] = checker.getTypeArguments(t as ts.TypeReference);
        if (!el) throw new Refuse(`${where} is an array of an unknown element type`);
        return { k: 'array', elem: tyOf(checker, el, `${where}[]`, depth + 1, stack) };
      }
      if (t.getCallSignatures().length > 0) throw new Refuse(`${where} is a function; functions are not generated as inputs`);
      if (t.getConstructSignatures().length > 0) throw new Refuse(`${where} is a class constructor; not generated`);
      const sym = t.getSymbol() ?? t.aliasSymbol;
      const name = sym?.getName() ?? '';
      if (BUILTIN_CLASSES.has(name)) throw new Refuse(`${where} is a ${name}; ${name} values are not generated`);
      if (sym?.declarations?.some((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d))) throw new Refuse(`${where} is an instance of class ${name}; class instances are not generated`);
      if (checker.getIndexInfosOfType(t).length > 0) throw new Refuse(`${where} is an object used as a dictionary (index signature); dictionaries are not generated`);
      const fields: Array<{ name: string; ty: STy; optional: boolean }> = [];
      for (const p of checker.getPropertiesOfType(t)) {
        if (p.getName() === SENTINEL_KEY) throw new Refuse(`${where} has a field named ${SENTINEL_KEY}, which Faithful uses to carry NaN, Infinity, -0 and undefined`);
        const d = p.valueDeclaration ?? p.declarations?.[0];
        if (!d) throw new Refuse(`${where}.${p.getName()} has no declaration`);
        if (ts.isMethodSignature(d) || ts.isMethodDeclaration(d)) throw new Refuse(`${where} has a method (${p.getName()}); objects with methods are not generated`);
        const optional = !!(p.flags & ts.SymbolFlags.Optional);
        let pt = checker.getTypeOfSymbolAtLocation(p, d);
        if (optional) pt = checker.getNonNullableType(pt);
        if (pt.getCallSignatures().length > 0) throw new Refuse(`${where}.${p.getName()} is a function; objects with methods are not generated`);
        fields.push({ name: p.getName(), ty: tyOf(checker, pt, `${where}.${p.getName()}`, depth + 1, stack), optional });
      }
      return { k: 'record', fields };
    } finally {
      stack.delete(t);
    }
  }
  throw new Refuse(`${where} has a type outside what the generator can draw (${checker.typeToString(t)})`);
}

/** Parameter types of `fnName` declared in `fileSource`, or a plain-words reason why inputs cannot be generated for it. */
export function inferSignature(fileSource: string, fnName: string): SignatureResult {
  const program = makeProgram(fileSource);
  const sf = program.getSourceFile(UNIT_FILE);
  const fn = sf ? findFunction(sf, fnName) : null;
  if (!sf || !fn) return { ok: false, reason: `no function declaration named ${fnName} with a body was found` };
  if (fn.typeParameters?.length) {
    return { ok: false, reason: `${fnName} is generic (type parameter${fn.typeParameters.length > 1 ? 's' : ''} ${fn.typeParameters.map((p) => p.name.text).join(', ')}); inputs cannot be generated without knowing the types` };
  }
  const checker = program.getTypeChecker();
  const params: SigParam[] = [];
  try {
    for (const p of fn.parameters) {
      const name = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sf);
      if (p.dotDotDotToken) throw new Refuse(`parameter ${name} is a rest parameter; rest parameters are not generated`);
      if (!p.type && !p.initializer) throw new Refuse(`parameter ${name} has no type annotation`);
      const optional = !!p.questionToken || !!p.initializer;
      // a defaulted parameter without an annotation has the (widened) type of its default
      let t = p.type ? checker.getTypeFromTypeNode(p.type) : checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(p));
      if (p.questionToken) t = checker.getNonNullableType(t);
      const ty = tyOf(checker, t, `parameter ${name}`, 0, new Set());
      params.push({ name, ty, optional });
    }
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, reason: e.message };
    throw e;
  }
  return { ok: true, sig: { fnName, params } };
}

/** "number (integers and non-integer doubles)", "array of string", "{ a: number, b?: string }", "number or null". */
export function styWords(t: STy): string {
  switch (t.k) {
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'literal':
      return t.values.length ? t.values.map((v) => JSON.stringify(v)).join(' | ') : 'nothing';
    case 'array':
      return `array of ${styWords(t.elem)}`;
    case 'tuple':
      return `[${t.elems.map(styWords).join(', ')}]`;
    case 'record':
      return `{ ${t.fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${styWords(f.ty)}`).join(', ')} }`;
    case 'nullable': {
      const extra = [t.nul ? 'null' : '', t.undef ? 'undefined' : ''].filter(Boolean).join(' or ');
      return t.inner.k === 'literal' && t.inner.values.length === 0 ? extra : `${styWords(t.inner)} or ${extra}`;
    }
  }
}

/** `average(xs: array of number)`. */
export function signatureWords(sig: FunctionSignature): string {
  return `${sig.fnName}(${sig.params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${styWords(p.ty)}`).join(', ')})`;
}

function hasNumber(t: STy): boolean {
  switch (t.k) {
    case 'number':
      return true;
    case 'array':
      return hasNumber(t.elem);
    case 'tuple':
      return t.elems.some(hasNumber);
    case 'record':
      return t.fields.some((f) => hasNumber(f.ty));
    case 'nullable':
      return hasNumber(t.inner);
    default:
      return false;
  }
}

/** Does any parameter carry a `number` (so non-integer doubles, and on opt-in NaN/Infinity/-0, are generated)? */
export function signatureHasNumbers(sig: FunctionSignature): boolean {
  return sig.params.some((p) => hasNumber(p.ty));
}

// ───────────────────────── value pools ─────────────────────────

const P53 = 2 ** 53;
/** Integer boundaries for `number`: zero, units, small negatives, byte/32-bit edges, around and beyond +-2^53. */
export const NUMBER_INT_BOUNDARIES: readonly number[] = [
  0, 1, -1, 2, -2, 3, -3, 10, -10, 100, -100, 255, 256, 2147483647, -2147483648, 4294967296, 2 ** 52, P53 - 1, -(P53 - 1), P53, -P53, P53 + 2, 1e21,
];
/** Non-integer finite doubles: halves (rounding), decimal fractions that are not exact in binary, tiny and huge magnitudes. */
export const NUMBER_FLOAT_BOUNDARIES: readonly number[] = [
  0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 0.1, 0.2, 0.3, 0.1 + 0.2, 1 / 3, -2 / 3, 0.49999999999999994, 9.5, 99.99, 123.456, -98.765,
  1e-7, -1e-7, Number.EPSILON, 1 + Number.EPSILON, 1e-300, 5e-324, 4503599627370495.5, 1.7976931348623157e308, -1.7976931348623157e308,
];
/** The opt-in labeled boundary set. */
export const NUMBER_SPECIALS: readonly Val[] = [special('NaN'), special('Infinity'), special('-Infinity'), special('-0')];

const ASCII_SMALL = ['a', 'b', 'c', 'A', 'B', ' '];
const ASCII_WIDE = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ' ', ',', '"', '-', '.', '!', '_', '/', '\\', '\n', '\t', '\u0000', '~'];
const NON_ASCII = ['é', 'É', 'ß', 'İ', 'ı', 'ǆ', 'ñ', 'Ω', '中', '…', '́', ' ', '﻿', '￿'];
const ASTRAL = ['😀', '𝟘', '😀'];

const STRING_BOUNDARIES = ['', 'a', 'A', ' ', 'ab', 'aa', 'aba', 'Abc', 'hello world', 'a,b,,c', '"q"', '0', '-1', '1.5', 'é', 'Straße', 'İ', '中文', 'a😀b', '😀', '\ud800'];

// ───────────────────────── generation ─────────────────────────

export interface SignatureGenOptions {
  n: number;
  seed: number;
  /** Generate NaN, Infinity, -Infinity and -0 as a labeled boundary set. Default false. */
  specials?: boolean;
  /** Maximum array length. Default 8. */
  maxArray?: number;
  /** Maximum string length. Default 12. */
  maxString?: number;
  /** Candidates tried before giving up on `n` distinct inputs. Default 40 * n + 1000. */
  maxAttempts?: number;
}

export interface SignatureInputs {
  /** Distinct inputs, boundary combinations first. JSON `Val`s with sentinels; run with `values: 'js'`. */
  inputs: Val[][];
  generated: number;
  duplicates: number;
  /** Inputs containing a non-integer finite number. */
  nonIntegerInputs: number;
  /** Inputs containing NaN, Infinity, -Infinity or -0 (only with `specials: true`). */
  specialInputs: number;
  exhausted: boolean;
}

interface Ctx {
  rng: Rng;
  specials: boolean;
  maxArray: number;
  maxString: number;
}

function randNumber(c: Ctx): Val {
  const r = c.rng.float();
  if (c.specials && r < 0.03) return c.rng.pick(NUMBER_SPECIALS);
  if (r < 0.33) return c.rng.int(-20, 20);
  if (r < 0.43) {
    const mag = 10 ** c.rng.int(2, 7);
    return c.rng.int(-mag, mag);
  }
  if (r < 0.5) return c.rng.pick(NUMBER_INT_BOUNDARIES);
  if (r < 0.57) return c.rng.pick(NUMBER_FLOAT_BOUNDARIES);
  if (r < 0.75) {
    // a non-integer with a short decimal expansion (k.5, k.25, k.1 ...), the kind people type
    const whole = c.rng.int(-100, 100);
    const frac = c.rng.pick([0.5, 0.25, 0.75, 0.1, 0.2, 0.9, 0.125, 0.01]);
    return whole < 0 ? whole - frac : whole + frac;
  }
  if (r < 0.92) {
    // uniform double in [-1000, 1000]
    const v = (c.rng.float() * 2 - 1) * 1000;
    return Number.isInteger(v) ? v + 0.5 : v;
  }
  // log-uniform magnitude 1e-8 .. 1e15, random sign; integers beyond 2^53 included by the boundary list
  const v = 10 ** (c.rng.float() * 23 - 8);
  return c.rng.chance(0.5) ? -v : v;
}

function randString(c: Ctx): string {
  const r = c.rng.float();
  const len = r < 0.12 ? 0 : r < 0.3 ? 1 : c.rng.int(2, c.maxString);
  const m = c.rng.float();
  const pool = m < 0.45 ? ASCII_SMALL : m < 0.8 ? ASCII_WIDE : m < 0.93 ? [...ASCII_SMALL, ...NON_ASCII] : [...ASCII_SMALL, ...NON_ASCII, ...ASTRAL];
  let s = '';
  for (let i = 0; i < len; i++) s += c.rng.pick(pool);
  return s;
}

function randValue(t: STy, c: Ctx, depth: number): Val {
  switch (t.k) {
    case 'number':
      return randNumber(c);
    case 'string':
      return randString(c);
    case 'boolean':
      return c.rng.chance(0.5);
    case 'literal':
      return t.values.length ? c.rng.pick(t.values) : null;
    case 'array': {
      const r = c.rng.float();
      const max = depth > 0 ? Math.min(4, c.maxArray) : c.maxArray;
      const len = r < 0.08 ? 0 : r < 0.18 ? 1 : c.rng.int(2, max);
      const xs: Val[] = [];
      for (let i = 0; i < len; i++) xs.push(randValue(t.elem, c, depth + 1));
      const shape = c.rng.float();
      if (len >= 2 && shape < 0.12) xs[c.rng.int(0, len - 1)] = structuredClone(xs[c.rng.int(0, len - 1)]!);
      else if (shape < 0.24 && (t.elem.k === 'number' || t.elem.k === 'string') && xs.every((x) => typeof x === typeof xs[0])) xs.sort((a, b) => (a! < b! ? -1 : a! > b! ? 1 : 0));
      return xs;
    }
    case 'tuple':
      return t.elems.map((e) => randValue(e, c, depth + 1));
    case 'record': {
      const o: { [k: string]: Val } = {};
      for (const f of t.fields) if (!(f.optional && c.rng.chance(0.25))) o[f.name] = randValue(f.ty, c, depth + 1);
      return o;
    }
    case 'nullable': {
      if (t.inner.k === 'literal' && t.inner.values.length === 0) return t.nul && (!t.undef || c.rng.chance(0.5)) ? null : special('undefined');
      if (c.rng.chance(0.2)) return t.nul && (!t.undef || c.rng.chance(0.5)) ? null : special('undefined');
      return randValue(t.inner, c, depth);
    }
  }
}

function sampleOf(t: STy, c: Ctx, k: number): Val {
  switch (t.k) {
    case 'number':
      return [0, 1, 0.5, -1, 2.5, -0.1][k % 6]!;
    case 'string':
      return ['a', '', 'ab', 'A', ' ', 'é'][k % 6]!;
    case 'boolean':
      return k % 2 === 0;
    default: {
      const b = boundaryValuesOf(t, c);
      return structuredClone(b[k % b.length]!);
    }
  }
}

/** Boundary values of one type, deterministic (the specials only when opted in). */
export function boundaryValuesOf(t: STy, c: Pick<Ctx, 'specials'>): Val[] {
  const ctx = c as Ctx;
  switch (t.k) {
    case 'number':
      return [...NUMBER_INT_BOUNDARIES.slice(0, 7), ...NUMBER_FLOAT_BOUNDARIES, ...NUMBER_INT_BOUNDARIES.slice(7), ...(c.specials ? NUMBER_SPECIALS : [])];
    case 'string':
      return [...STRING_BOUNDARIES];
    case 'boolean':
      return [false, true];
    case 'literal':
      return t.values.length ? [...t.values] : [null];
    case 'array': {
      const e = t.elem;
      const out: Val[] = [[], [sampleOf(e, ctx, 0)], [sampleOf(e, ctx, 2)]];
      if (e.k === 'number') {
        out.push([1, 2], [1, 2, 3], [3, 2, 1], [0.5, 1.5], [0.1, 0.2, 0.3], [1, 2.5], [-1.5, -2.5], [2, 2, 2], [1, 1, 2, 3, 3], [-5, 0, 5], [1e16, 1, -1e16], [P53, 1], [1.7976931348623157e308, 1.7976931348623157e308], [5e-324, 5e-324], [7]);
        if (c.specials) out.push([special('NaN')], [special('Infinity'), special('-Infinity')], [special('-0')], [1, special('NaN')], [special('-0'), 0]);
      } else if (e.k === 'string') {
        out.push(['a', 'b', 'c'], ['c', 'b', 'a'], ['a', 'a'], ['', 'x'], ['ab', 'AB', 'ab'], ['é', 'e'], ['😀', 'a']);
      } else {
        out.push([sampleOf(e, ctx, 0), sampleOf(e, ctx, 0)], [sampleOf(e, ctx, 0), sampleOf(e, ctx, 1), sampleOf(e, ctx, 2)]);
      }
      return out;
    }
    case 'tuple': {
      const out: Val[] = [];
      for (let k = 0; k < 6; k++) out.push(t.elems.map((e) => sampleOf(e, ctx, k)));
      return out;
    }
    case 'record': {
      const out: Val[] = [];
      for (let k = 0; k < 6; k++) {
        const o: { [f: string]: Val } = {};
        for (const f of t.fields) if (!(f.optional && k % 3 === 2)) o[f.name] = sampleOf(f.ty, ctx, k);
        out.push(o);
      }
      return out;
    }
    case 'nullable': {
      const none: Val[] = [...(t.nul ? [null] : []), ...(t.undef ? [special('undefined')] : [])];
      return t.inner.k === 'literal' && t.inner.values.length === 0 ? none : [...none, ...boundaryValuesOf(t.inner, c).slice(0, 6)];
    }
  }
}

function paramBoundaries(p: SigParam, c: Ctx): Val[] {
  const b = boundaryValuesOf(p.ty, c);
  return p.optional && !(p.ty.k === 'nullable' && p.ty.undef) ? [...b, special('undefined')] : b;
}

/** Deterministic inputs for a signature. See the module comment. */
export function generateSignatureInputs(sig: FunctionSignature, opts: SignatureGenOptions): SignatureInputs {
  const c: Ctx = { rng: new Rng(opts.seed), specials: opts.specials ?? false, maxArray: opts.maxArray ?? 8, maxString: opts.maxString ?? 12 };
  const out: SignatureInputs = { inputs: [], generated: 0, duplicates: 0, nonIntegerInputs: 0, specialInputs: 0, exhausted: false };
  const seen = new Set<string>();
  const offer = (args: Val[]): void => {
    if (out.inputs.length >= opts.n) return;
    out.generated++;
    const key = JSON.stringify(args);
    if (seen.has(key)) {
      out.duplicates++;
      return;
    }
    seen.add(key);
    out.inputs.push(args);
    if (args.some(containsNonInteger)) out.nonIntegerInputs++;
    if (args.some(containsSpecialNumber)) out.specialInputs++;
  };
  const params = sig.params;
  if (params.length === 0) {
    offer([]);
  } else {
    // 1. boundary combinations (at most a third of the budget): diagonal walks with different strides
    const bvs = params.map((p) => paramBoundaries(p, c));
    const longest = Math.max(...bvs.map((b) => b.length));
    const budget = Math.max(1, Math.floor(opts.n / 3));
    let made = 0;
    for (const stride of [0, 1, 3, 7]) {
      for (let k = 0; k < longest && made < budget; k++) {
        offer(bvs.map((b, j) => structuredClone(b[(k + stride * j) % b.length]!)));
        made++;
      }
    }
    // 2. random
    const maxAttempts = opts.maxAttempts ?? 40 * opts.n + 1000;
    for (let a = 0; out.inputs.length < opts.n && a < maxAttempts; a++) {
      offer(params.map((p) => (p.optional && c.rng.chance(0.1) ? special('undefined') : randValue(p.ty, c, 0))));
    }
  }
  out.exhausted = out.inputs.length < opts.n;
  return out;
}

// ───────────────────────── benchmark distribution ─────────────────────────

/**
 * One argument of a given size for the benchmark distribution of a Tested-only function: a scalar `number` parameter is
 * an integer in [0, size] (sizes and counts), a number inside an array, tuple or record is a non-integer double in
 * [-size, size]; arrays have `size` elements (nested ones at most 4), strings `size` lowercase letters. Plain finite JSON
 * only (no sentinels): the benchmark harness passes arguments as they are.
 */
export function sizedValue(t: STy, size: number, rng: () => number, nested = false): Val {
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  switch (t.k) {
    case 'number':
      return nested ? Math.round(((rng() * 2 - 1) * size + (rng() < 0.5 ? 0.5 : 0.25)) * 1000) / 1000 : int(0, size);
    case 'string':
      return Array.from({ length: size }, () => String.fromCharCode(97 + int(0, 25))).join('');
    case 'boolean':
      return rng() < 0.5;
    case 'literal':
      return t.values.length ? t.values[int(0, t.values.length - 1)]! : null;
    case 'array':
      return Array.from({ length: nested ? Math.min(size, 4) : size }, () => sizedValue(t.elem, nested ? Math.min(size, 4) : size, rng, true));
    case 'tuple':
      return t.elems.map((e) => sizedValue(e, size, rng, true));
    case 'record':
      return Object.fromEntries(t.fields.map((f) => [f.name, sizedValue(f.ty, size, rng, true)]));
    case 'nullable':
      return t.inner.k === 'literal' && t.inner.values.length === 0 ? null : sizedValue(t.inner, size, rng, nested);
  }
}

/** Words for the benchmark distribution built by `sizedValue`. */
export function sizedDistributionWords(sig: FunctionSignature): string {
  const w = (t: STy): string =>
    t.k === 'number' ? 'integer in [0, n]' : t.k === 'array' ? `array of n ${t.elem.k === 'number' ? 'non-integer doubles in [-n, n]' : styWords(t.elem)}` : t.k === 'string' ? 'n lowercase letters' : styWords(t);
  return sig.params.map((p) => `${p.name}: ${w(p.ty)}`).join('; ');
}
