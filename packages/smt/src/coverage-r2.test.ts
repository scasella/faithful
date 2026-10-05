/**
 * Regression tests for red-team round 2, findings R2-V4 (the "all integers 0" coverage split classified size-driven
 * exclusions as int-driven, so `unsat` stood over inputs that differ), r2MergeCapIntGatedDiffer (the same, through a
 * merge that is short when every element is 0) and R2-L1 (a loop of exactly U iterations was excluded although the
 * note says "finish within U iterations"). Inline minimal pairs (no dependence on the redteam directories). Ground
 * truth for every "differs" / "no difference" claim is a sandbox run of the instrumented functions.
 *
 * The fix (equivalence.ts coverageCheck, encode.ts fuel): an exclusion with every integer in [-1, 1] is size-driven
 * (`unknown`, verifiedToK raises U); any other exclusion NARROWS the result's `bounds.int` to an integer bound inside
 * which Z3 checked that no input is excluded, so `unsat` is exact for the bounds it states. Loop fuel counts iterations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, liveSandboxWorkers, outcomeEqual } from '@faithful/engine';
import { translateWithIr, type Val } from '@faithful/translate';
import { DEFAULT_STEPS, checkEquivalent, verifiedToK, type FnUnderTest } from './equivalence.js';
import type { Bounds } from './inputs.js';
import { runInstrumented } from './replay.js';
import { openSystemZ3, openWasmZ3, type Z3Driver } from './z3.js';

function fn(source: string, name = 'f'): FnUnderTest {
  const w = translateWithIr(source, name);
  if (!w.result.ok || !w.ir) throw new Error(`fixture not translated: ${JSON.stringify(w.result)}`);
  return { translation: w.result, ir: w.ir };
}

const z3: Z3Driver | null = (await openSystemZ3()) ?? (await openWasmZ3());
let sandbox: Sandbox;
beforeAll(async () => {
  sandbox = await Sandbox.open();
});
afterAll(async () => {
  await sandbox?.close();
  expect(liveSandboxWorkers()).toBe(0);
});

/** Inputs where the original is inside the model and the replayed outcomes differ. */
async function diffsOn(o: FnUnderTest, c: FnUnderTest, inputs: Val[][]): Promise<Val[][]> {
  const [ro, rc] = await runInstrumented([o.translation, c.translation], inputs, { sandbox });
  return inputs.filter((_, i) => {
    const a = ro![i]!;
    const b = rc![i]!;
    return (a.tag === 'ok' || a.tag === 'throw') && b.tag !== 'fault' && !outcomeEqual(a, b);
  });
}

/** Every (n, xs) with |n| <= m and xs of at most `arr` elements over [-m, m]. */
function intAndArray(m: number, arr: number): Val[][] {
  const ints: number[] = [];
  for (let i = -m; i <= m; i++) ints.push(i);
  let arrays: Val[][] = [[]];
  let layer: Val[][] = [[]];
  for (let n = 1; n <= arr; n++) {
    layer = layer.flatMap((xs) => ints.map((x) => [...xs, x]));
    arrays = arrays.concat(layer);
  }
  return ints.flatMap((n) => arrays.map((xs) => [n, xs] as Val[]));
}

function maxAbs(v: Val): number {
  if (typeof v === 'number') return Math.abs(v);
  if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, maxAbs(x)), 0);
  return 0;
}

// R2-V4 shapes: a loop driven only by the array length, hidden from an all-zero probe.
const LOOP = 'let s = 0; for (let i = 0; i < 100 * xs.length; i++) { s += 1; } return s;';
const SHORT = 'return xs.length >= 1 ? 7 : 0;';
const GUARDED: Array<{ name: string; o: FnUnderTest; c: FnUnderTest; witness: Val[] }> = [
  {
    name: 'early return at n = 0',
    o: fn(`export function f(n: number, xs: number[]): number { if (n === 0) { return 0; } ${LOOP} }`),
    c: fn(`export function f(n: number, xs: number[]): number { if (n === 0) { return 0; } ${SHORT} }`),
    witness: [1, [0]],
  },
  {
    name: 'throw at n = 0',
    o: fn(`export function f(n: number, xs: number[]): number { if (n === 0) { throw new Error("zero"); } ${LOOP} }`),
    c: fn(`export function f(n: number, xs: number[]): number { if (n === 0) { throw new Error("zero"); } ${SHORT} }`),
    witness: [1, [0]],
  },
  {
    name: 'the all-zero input leaves the model (12 % n)',
    o: fn(`export function f(n: number, xs: number[]): number { const q = 12 % n; let s = q; for (let i = 0; i < 100 * xs.length; i++) { s += 1; } return s; }`),
    c: fn(`export function f(n: number, xs: number[]): number { const q = 12 % n; return xs.length >= 1 ? q + 7 : q; }`),
    witness: [1, [0]],
  },
  {
    name: 'early return when the first element is 0',
    o: fn(`export function f(n: number, xs: number[]): number { if (xs.length > 0 && xs[0] === 0) { return 0; } ${LOOP} }`),
    c: fn(`export function f(n: number, xs: number[]): number { if (xs.length > 0 && xs[0] === 0) { return 0; } ${SHORT} }`),
    witness: [0, [1]],
  },
];

describe.skipIf(!z3)('R2-V4: a size-driven exclusion hidden from the all-zero input is never unsat', () => {
  for (const p of GUARDED) {
    it(`${p.name}: checkEquivalent is not unsat at (arrays 2, ints ±3, U 4) and verifiedToK claims nothing`, async () => {
      expect(await diffsOn(p.o, p.c, [p.witness])).toHaveLength(1);
      const r = await checkEquivalent(p.o, p.c, { array: 2, string: 1, int: 3, unroll: 4 }, 60_000, z3!, { sandbox });
      expect(r.status, `${r.reason ?? ''} ${JSON.stringify(r.coverage ?? null)}`).not.toBe('unsat');
      expect(r.coverage?.kind).toBe('size-driven');
      expect(maxAbs(r.coverage!.example!)).toBeLessThanOrEqual(1);
      const v = await verifiedToK(p.o, p.c, { budgetMs: 120_000, z3: z3!, sandbox });
      const trail = v.attempts.map((a) => `${a.status}@A${a.bounds.array}/I${a.bounds.int}/U${a.unroll}/${a.coverage?.kind ?? '-'}`).join(', ');
      expect(v.detail?.result, trail).not.toBe('unsat');
      expect(v.result.status, trail).not.toBe('unsat');
    }, 300_000);
  }
});

describe.skipIf(!z3)('r2MergeCapIntGatedDiffer: a merge whose length-driven trip count needs interleaved values', () => {
  const MERGE = (cap: string, tails: string) =>
    fn(`export function f(a: number[], b: number[]): number[] {
      let out: number[] = []; let i = 0; let j = 0;
      for (let k = 0; k < ${cap}; k++) {
        if (i >= a.length || j >= b.length) { break; }
        if (a[i] <= b[j]) { out = out.concat([a[i]]); i = i + 1; } else { out = out.concat([b[j]]); j = j + 1; }
      }
      return ${tails};
    }`);
  const O = MERGE('a.length + b.length', 'out.concat(a.slice(i), b.slice(j))');
  const C = MERGE('Math.min(10, a.length + b.length)', 'out.concat(b.slice(j), a.slice(i))');
  const W: Val[] = [[1, 3, 5, 7, 9, 11], [2, 4, 6, 8, 10, 12]];

  it('at the default bounds (U = 10) the answer is size-driven unknown, never unsat; verifiedToK never claims bounds containing the witness', async () => {
    expect(await diffsOn(O, C, [W])).toHaveLength(1);
    const top = DEFAULT_STEPS[DEFAULT_STEPS.length - 1]!;
    const r = await checkEquivalent(O, C, top, 120_000, z3!, { sandbox });
    expect(r.status, `${r.reason ?? ''} ${JSON.stringify(r.coverage ?? null)}`).toBe('unknown');
    expect(r.coverage?.kind).toBe('size-driven');
    const v = await verifiedToK(O, C, { budgetMs: 240_000, z3: z3!, sandbox });
    const trail = v.attempts.map((a) => `${a.status}@A${a.bounds.array}/I${a.bounds.int}/U${a.unroll}/${a.coverage?.kind ?? '-'}`).join(', ');
    const res = v.result;
    const containsW = res.bounds.array >= 6 && res.bounds.int >= 12;
    expect(res.status === 'unsat' && containsW, trail).toBe(false);
    if (res.status === 'sat') expect(outcomeEqual(res.counterexample!.original, res.counterexample!.candidate)).toBe(false);
  }, 400_000);
});

describe.skipIf(!z3)('integer-driven exclusion: the reported integer bound is narrowed and exact', () => {
  // the documented caveat (r2v06 shape): n = -3 with two elements needs 5 iterations
  const MINUS_O = fn('export function f(n: number, xs: number[]): number { let c = 0; for (let i = 0; i < xs.length - n; i++) { c += 1; } return c; }');
  const MINUS_C = fn('export function f(n: number, xs: number[]): number { return Math.max(0, xs.length - n); }');
  // a pair that DOES differ, only at n >= 6, where the loop needs more than U = 4 iterations
  const FAR_O = fn('export function f(n: number, xs: number[]): number { let c = 0; for (let i = 0; i < n; i++) { c += 1; } return c + xs.length; }');
  const FAR_C = fn('export function f(n: number, xs: number[]): number { return (n >= 6 ? 0 : Math.max(0, n)) + xs.length; }');

  it('equal pair: unsat with bounds.int narrowed to 2 (the excluded example lies outside), and exhaustive ground truth inside agrees', async () => {
    const b: Bounds & { unroll: number } = { array: 2, string: 1, int: 3, unroll: 4 };
    const r = await checkEquivalent(MINUS_O, MINUS_C, b, 60_000, z3!, { sandbox });
    expect(r.status, r.reason).toBe('unsat');
    expect(r.coverage).toMatchObject({ kind: 'int-driven', intBound: 2, requestedInt: 3 });
    expect(r.bounds).toEqual({ array: 2, string: 1, int: 2 });
    expect(maxAbs(r.coverage!.example!)).toBeGreaterThan(r.bounds.int);
    expect(r.encodingNote).toContain('every number an integer in [-2, 2]');
    expect(r.encodingNote).toContain('NARROWED to integers in [-2, 2]');
    expect(r.encodingNote).toContain('4 iterations');
    expect(await diffsOn(MINUS_O, MINUS_C, intAndArray(r.bounds.int, r.bounds.array))).toEqual([]);
  }, 120_000);

  it('differing pair: the difference at n = 6 is outside the narrowed bound; the claim never covers it', async () => {
    expect(await diffsOn(FAR_O, FAR_C, [[6, []]])).toHaveLength(1);
    const r = await checkEquivalent(FAR_O, FAR_C, { array: 1, string: 1, int: 8, unroll: 4 }, 60_000, z3!, { sandbox });
    expect(r.status, r.reason).toBe('unsat');
    expect(r.coverage?.kind).toBe('int-driven');
    // n = 4 is the largest trip count that fits U = 4 (iterations, R2-L1)
    expect(r.bounds.int).toBe(4);
    expect(await diffsOn(FAR_O, FAR_C, intAndArray(r.bounds.int, r.bounds.array))).toEqual([]);
    expect(r.encodingNote).toContain('SOME INPUTS INSIDE THESE BOUNDS WERE EXCLUDED');
  }, 120_000);
});

describe.skipIf(!z3)('R2-L1: fuel counts iterations', () => {
  const FOUR = fn('export function f(n: number): number { let s = 0; for (let i = 0; i < 4; i++) { s += i; } return s + n; }');
  const FIVE = fn('export function f(n: number): number { let s = 0; for (let i = 0; i < 5; i++) { s += i; } return s + n; }');
  const b = { array: 1, string: 1, int: 2, unroll: 4 };

  it('a loop of exactly U = 4 iterations is covered: equal is unsat (full), different is a replayed sat', async () => {
    const eqR = await checkEquivalent(FOUR, fn('export function f(n: number): number { return n + 6; }'), b, 60_000, z3!, { sandbox });
    expect(eqR.status, eqR.reason).toBe('unsat');
    expect(eqR.coverage).toEqual({ kind: 'full' });
    expect(eqR.encodingNote).toContain('within 4 iterations');
    const neR = await checkEquivalent(FOUR, fn('export function f(n: number): number { return n + 7; }'), b, 60_000, z3!, { sandbox });
    expect(neR.status, neR.reason).toBe('sat');
    expect(outcomeEqual(neR.counterexample!.original, neR.counterexample!.candidate)).toBe(false);
  }, 120_000);

  it('a loop of U + 1 = 5 iterations is still excluded at U = 4 (vacuous, never unsat)', async () => {
    const r = await checkEquivalent(FIVE, fn('export function f(n: number): number { return n + 11; }'), b, 60_000, z3!, { sandbox });
    expect(r.status).toBe('unknown');
    expect(r.coverage).toEqual({ kind: 'vacuous', fuel: true });
  }, 120_000);
});
