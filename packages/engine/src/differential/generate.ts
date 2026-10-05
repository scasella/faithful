/**
 * Deterministic, seeded input generation for the differential tester.
 *
 * Inputs are drawn from the parameter types (`Ty`) and filtered by the translation's preconditions:
 *  - every precondition with a `ts` expression (int-bound, bmp, ...) is evaluated on the candidate arguments
 *    (rejection sampling); a candidate that fails one, or makes it throw, is rejected and counted;
 *  - `range-ok` (and `ascii`) have no `ts` expression: they are enforced later by running the instrumented original
 *    (outcome `range-violation`), see differential.ts. This module never runs the function.
 *
 * Boundary values come first (empty, single element, zero, +-1, negatives, +-2^53 and +-(2^53 - 1), duplicates, sorted and
 * reverse-sorted arrays, non-ASCII BMP text, ASCII-only text when an `ascii` precondition applies). Strings with
 * surrogate code units (astral characters, lone surrogates) are generated only as EXCLUDED cases: they are offered to the
 * `bmp` predicate, which must reject them, and are never returned as inputs.
 *
 * Same (translation, options) => same inputs, on every machine: the PRNG is mulberry32 seeded from `seed`, and no
 * iteration order depends on anything but the arguments.
 */
import { MAX_SAFE, type Param, type Precondition, type Ty, type Val } from '@faithful/translate';

export interface GenOptions {
  /** Number of accepted (precondition-satisfying, distinct) inputs wanted. */
  n: number;
  seed: number;
  /** Maximum array length. Default 8. */
  maxArray?: number;
  /** Maximum string length (UTF-16 units). Default 12. */
  maxString?: number;
  /** Most integers are drawn from [-smallInt, smallInt]. Default 20. */
  smallInt?: number;
  /** Candidates tried before giving up on reaching `n` distinct accepted inputs. Default 40 * n + 1000. */
  maxAttempts?: number;
}

export interface GeneratedInputs {
  /** Accepted inputs, distinct, boundary cases first. */
  inputs: Val[][];
  /** Candidates produced (accepted + rejected + duplicates). */
  generated: number;
  /** Candidates rejected by a precondition's `ts` expression, keyed by precondition id. */
  rejected: Record<string, number>;
  /** Candidates dropped because an identical input was already accepted. */
  duplicates: number;
  /** Surrogate-containing strings offered to the `bmp` predicate; all must be rejected (see `excludedAccepted`). */
  excludedOffered: number;
  /** Excluded (surrogate) cases that a predicate ACCEPTED: a precondition bug. Never returned as inputs. */
  excludedAccepted: Val[][];
  /** True when `inputs.length < n` because the attempt budget ran out (e.g. a very narrow precondition). */
  exhausted: boolean;
}

// ───────────────────────── PRNG ─────────────────────────

/** mulberry32: small, fast, good enough for test-input generation, and identical everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  /** Uniform integer in [lo, hi] (inclusive; |lo|, |hi| <= 2^53). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ───────────────────────── value pools ─────────────────────────

const P53 = MAX_SAFE; // 2^53
/** Integer boundaries: zero, units, small negatives, 32-bit edges, sqrt(2^53) neighbourhood, +-2^53 and +-(2^53 - 1). */
export const INT_BOUNDARIES: readonly number[] = [
  0, 1, -1, 2, -2, 3, -3, 10, -10, 100, -100,
  2147483647, -2147483648, 94906265, 94906266, -94906266,
  2 ** 52, -(2 ** 52), P53 - 1, -(P53 - 1), P53, -P53,
];

const ASCII_SMALL = ['a', 'b', 'c', 'A', 'B', ' '];
const ASCII_WIDE = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ' ', ' ', ',', '"', '-', '.', '!', '_', '/', '\\', '\n', '\t', '\u0000', '\u001f', '\u007f', '~',
];
/** Non-ASCII BMP text: case-mapping troublemakers (ß, İ, ǆ), combining marks, NBSP/LS/BOM, the code units next to the
 * surrogate block (U+D7FF, U+E000) and U+FFFF. All are single UTF-16 code units outside the surrogate range. */
const NON_ASCII_BMP = [
  'é', 'É', 'ß', 'İ', 'ı', 'ǆ', 'ñ', 'Ω', 'ω', 'ä', 'Ä', '中', '…', '́', ' ', ' ', '﻿',
  '퟿', '', '￿', 'Ā',
];
/** Surrogate-containing strings: excluded cases only (the `bmp` predicate must reject them). */
export const SURROGATE_CASES: readonly string[] = ['😀', 'a😀b', '\ud800', '\udfff', 'x\udc00', '\ud83d', '\ud800\ud800'];

// ───────────────────────── random values ─────────────────────────

interface Ctx {
  rng: Rng;
  maxArray: number;
  maxString: number;
  smallInt: number;
  /** Prefer ASCII-only strings (an `ascii` precondition applies). */
  asciiBias: boolean;
}

function randInt(c: Ctx): number {
  const r = c.rng.float();
  if (r < 0.6) return c.rng.int(-c.smallInt, c.smallInt);
  if (r < 0.75) {
    const mag = 10 ** c.rng.int(2, 7);
    return c.rng.int(-mag, mag);
  }
  if (r < 0.85) return c.rng.pick(INT_BOUNDARIES);
  // log-uniform tail up to 2^53
  const bits = c.rng.float() * 53;
  const v = Math.min(P53, Math.floor(2 ** bits));
  return c.rng.chance(0.5) ? -v : v;
}

function randString(c: Ctx): string {
  const r = c.rng.float();
  const len = r < 0.15 ? 0 : r < 0.35 ? 1 : c.rng.int(2, c.maxString);
  const mode = c.rng.float();
  // ascii bias: 85% ASCII-only; otherwise 20% of strings may contain non-ASCII BMP characters
  const nonAsciiP = c.asciiBias ? 0.15 : 0.25;
  const pool = mode < 0.45 ? ASCII_SMALL : mode < 1 - nonAsciiP ? ASCII_WIDE : [...ASCII_SMALL, ...NON_ASCII_BMP];
  let s = '';
  for (let i = 0; i < len; i++) s += c.rng.pick(pool);
  return s;
}

function cmpVal(a: Val, b: Val): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function randValue(ty: Ty, c: Ctx, depth = 0): Val {
  switch (ty.k) {
    case 'int':
      return randInt(c);
    case 'bool':
      return c.rng.chance(0.5);
    case 'string':
      return randString(c);
    case 'array': {
      const r = c.rng.float();
      const max = depth > 0 ? Math.min(4, c.maxArray) : c.maxArray;
      const len = r < 0.1 ? 0 : r < 0.2 ? 1 : c.rng.int(2, max);
      const xs: Val[] = [];
      for (let i = 0; i < len; i++) xs.push(randValue(ty.elem, c, depth + 1));
      const shape = c.rng.float();
      if (len >= 2 && shape < 0.15) {
        // duplicates: copy one element over another
        xs[c.rng.int(0, len - 1)] = structuredClone(xs[c.rng.int(0, len - 1)]!);
      } else if (shape < 0.3 && (ty.elem.k === 'int' || ty.elem.k === 'string')) {
        xs.sort(cmpVal);
      } else if (shape < 0.4 && (ty.elem.k === 'int' || ty.elem.k === 'string')) {
        xs.sort((a, b) => cmpVal(b, a));
      }
      return xs;
    }
    case 'tuple':
      return ty.elems.map((e) => randValue(e, c, depth + 1));
    case 'record': {
      const o: { [k: string]: Val } = {};
      for (const f of ty.fields) o[f.name] = randValue(f.ty, c, depth + 1);
      return o;
    }
    case 'option':
      // Options occur only in return types in subset v1; generate the inner value or null for completeness.
      return c.rng.chance(0.3) ? null : randValue(ty.inner, c, depth + 1);
  }
}

// ───────────────────────── boundary values ─────────────────────────

function sampleOf(ty: Ty, c: Ctx, k: number): Val {
  // deterministic small values for building boundary composites
  switch (ty.k) {
    case 'int':
      return [0, 1, -1, 2, 5, -3][k % 6]!;
    case 'bool':
      return k % 2 === 0;
    case 'string':
      return ['a', '', 'ab', 'A', ' ', 'é'][k % 6]!;
    default:
      return boundaryValues(ty, c)[k % boundaryValues(ty, c).length]!;
  }
}

/** Boundary values of a type, deterministic. */
export function boundaryValues(ty: Ty, c: Ctx): Val[] {
  switch (ty.k) {
    case 'int':
      return [...INT_BOUNDARIES];
    case 'bool':
      return [false, true];
    case 'string': {
      const ascii = ['', 'a', 'A', ' ', 'ab', 'aa', 'aba', 'Abc', 'hello world', 'a,b,,c', '"q"', 'zZ09', '\u0000\t x \n'];
      const nonAscii = ['é', 'É', 'ß', 'İ', 'ǆ', 'Straße', 'éx́', '中文', 'a…', ' x﻿', '퟿￿'];
      return c.asciiBias ? [...ascii, ...nonAscii.slice(0, 4)] : [...ascii, ...nonAscii];
    }
    case 'array': {
      const e = ty.elem;
      const out: Val[] = [[], [sampleOf(e, c, 0)], [sampleOf(e, c, 1)]];
      if (e.k === 'int') {
        out.push([1, 2, 3], [3, 2, 1], [2, 2, 2], [1, 1, 2, 3, 3], [-5, 0, 5], [5, 0, -5], [-1, -2, -3], [0, 0], [P53, 1], [-P53, -1], [P53 - 1, 1], [7]);
      } else if (e.k === 'string') {
        out.push(['a', 'b', 'c'], ['c', 'b', 'a'], ['a', 'a'], ['', 'x'], ['ab', 'AB', 'ab'], ['é', 'e']);
      } else {
        out.push([sampleOf(e, c, 0), sampleOf(e, c, 0)], [sampleOf(e, c, 0), sampleOf(e, c, 1), sampleOf(e, c, 2)]);
      }
      return out;
    }
    case 'tuple': {
      const out: Val[] = [];
      for (let k = 0; k < 4; k++) out.push(ty.elems.map((e) => sampleOf(e, c, k)));
      return out;
    }
    case 'record': {
      const out: Val[] = [];
      for (let k = 0; k < 4; k++) {
        const o: { [f: string]: Val } = {};
        for (const f of ty.fields) o[f.name] = sampleOf(f.ty, c, k);
        out.push(o);
      }
      return out;
    }
    case 'option':
      return [null, ...boundaryValues(ty.inner, c).slice(0, 3)];
  }
}

function containsString(ty: Ty): boolean {
  switch (ty.k) {
    case 'string':
      return true;
    case 'array':
      return containsString(ty.elem);
    case 'tuple':
      return ty.elems.some(containsString);
    case 'record':
      return ty.fields.some((f) => containsString(f.ty));
    case 'option':
      return containsString(ty.inner);
    default:
      return false;
  }
}

/** Replace the first string inside a value of type `ty` (creating one in an empty array) with `s`. */
function withString(ty: Ty, v: Val, s: string): Val {
  switch (ty.k) {
    case 'string':
      return s;
    case 'array': {
      const xs = Array.isArray(v) ? [...v] : [];
      if (xs.length === 0) return [withString(ty.elem, defaultOf(ty.elem), s)];
      xs[0] = withString(ty.elem, xs[0]!, s);
      return xs;
    }
    case 'tuple': {
      const xs = [...(v as Val[])];
      const i = ty.elems.findIndex(containsString);
      xs[i] = withString(ty.elems[i]!, xs[i]!, s);
      return xs;
    }
    case 'record': {
      const o = { ...(v as { [k: string]: Val }) };
      const f = ty.fields.find((x) => containsString(x.ty))!;
      o[f.name] = withString(f.ty, o[f.name]!, s);
      return o;
    }
    default:
      return v;
  }
}

function defaultOf(ty: Ty): Val {
  switch (ty.k) {
    case 'int':
      return 0;
    case 'bool':
      return false;
    case 'string':
      return '';
    case 'array':
      return [];
    case 'tuple':
      return ty.elems.map(defaultOf);
    case 'record': {
      const o: { [k: string]: Val } = {};
      for (const f of ty.fields) o[f.name] = defaultOf(f.ty);
      return o;
    }
    case 'option':
      return null;
  }
}

// ───────────────────────── preconditions ─────────────────────────

export interface CompiledPrecondition {
  id: string;
  test: (args: Val[]) => boolean;
}

/** Compile every precondition that has a `ts` expression into a predicate over the argument list. */
export function compilePreconditions(params: Param[], preconditions: Precondition[]): CompiledPrecondition[] {
  const names = params.map((p) => p.name);
  const out: CompiledPrecondition[] = [];
  for (const p of preconditions) {
    if (p.ts === undefined) continue;
    let f: (...a: unknown[]) => unknown;
    try {
      f = new Function(...names, `"use strict"; return (${p.ts});`) as (...a: unknown[]) => unknown;
    } catch (e) {
      throw new Error(`precondition ${p.id}: ts expression does not compile: ${(e as Error).message}: ${p.ts}`);
    }
    out.push({
      id: p.id,
      test: (args) => {
        try {
          return f(...structuredClone(args)) === true;
        } catch {
          return false;
        }
      },
    });
  }
  return out;
}

// ───────────────────────── driver ─────────────────────────

/** Deterministic inputs for a function with these parameters and preconditions. See the module comment. */
export function generateInputs(t: { params: Param[]; preconditions: Precondition[] }, opts: GenOptions): GeneratedInputs {
  const c: Ctx = {
    rng: new Rng(opts.seed),
    maxArray: opts.maxArray ?? 8,
    maxString: opts.maxString ?? 12,
    smallInt: opts.smallInt ?? 20,
    asciiBias: t.preconditions.some((p) => p.kind === 'ascii'),
  };
  const preds = compilePreconditions(t.params, t.preconditions);
  const out: GeneratedInputs = { inputs: [], generated: 0, rejected: {}, duplicates: 0, excludedOffered: 0, excludedAccepted: [], exhausted: false };
  const seen = new Set<string>();
  const accepts = (args: Val[]): string | null => {
    for (const p of preds) if (!p.test(args)) return p.id;
    return null;
  };
  const offer = (args: Val[]): void => {
    if (out.inputs.length >= opts.n) return;
    out.generated++;
    const bad = accepts(args);
    if (bad !== null) {
      out.rejected[bad] = (out.rejected[bad] ?? 0) + 1;
      return;
    }
    const key = JSON.stringify(args);
    if (seen.has(key)) {
      out.duplicates++;
      return;
    }
    seen.add(key);
    out.inputs.push(args);
  };

  const params = t.params;
  // 1. excluded cases: surrogate-containing strings must be rejected by a precondition and never become inputs
  const stringParams = params.map((p, i) => [p, i] as const).filter(([p]) => containsString(p.ty));
  for (const [p, i] of stringParams) {
    for (const s of SURROGATE_CASES) {
      const args = params.map((q) => defaultOf(q.ty));
      args[i] = withString(p.ty, args[i]!, s);
      out.excludedOffered++;
      out.generated++;
      const bad = accepts(args);
      if (bad === null) out.excludedAccepted.push(args);
      else out.rejected[bad] = (out.rejected[bad] ?? 0) + 1;
    }
  }

  // 2. boundary combinations (at most a third of the budget)
  if (params.length > 0) {
    const bvs = params.map((p) => boundaryValues(p.ty, c));
    const longest = Math.max(...bvs.map((b) => b.length));
    const budget = Math.max(1, Math.floor(opts.n / 3));
    let made = 0;
    // diagonal walks with different strides mix the boundary values of different parameters
    for (const stride of [0, 1, 3, 7]) {
      for (let k = 0; k < longest && made < budget; k++) {
        const args = bvs.map((b, j) => structuredClone(b[(k + stride * j) % b.length]!));
        offer(args);
        made++;
      }
    }
  } else {
    offer([]);
  }

  // 3. random
  const maxAttempts = opts.maxAttempts ?? 40 * opts.n + 1000;
  let attempts = 0;
  while (out.inputs.length < opts.n && attempts < maxAttempts) {
    attempts++;
    if (params.length === 0) break;
    offer(params.map((p) => randValue(p.ty, c)));
  }
  out.exhausted = out.inputs.length < opts.n;
  return out;
}
