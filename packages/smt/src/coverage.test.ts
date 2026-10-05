/**
 * Regression tests for red-team round 1, findings V1/V3 and the fuel-exclusion findings (arrays, strings-decode):
 * an `unsat` ("Verified to k") must never stand on a checked set that is empty, or that silently leaves out inputs
 * inside the stated sequence bounds because they need more than U iterations. Inline minimal pairs (no dependence on
 * the redteam directories). Ground truth for every "differs" claim is a sandbox run of the instrumented functions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, liveSandboxWorkers, outcomeEqual } from '@faithful/engine';
import { translateWithIr, type Val } from '@faithful/translate';
import { DEFAULT_STEPS, checkEquivalent, verifiedToK, type EquivBounds, type FnUnderTest } from './equivalence.js';
import { runInstrumented } from './replay.js';
import { openSystemZ3, openWasmZ3, type Z3Driver } from './z3.js';

function fn(source: string, name = 'f'): FnUnderTest {
  const w = translateWithIr(source, name);
  if (!w.result.ok || !w.ir) throw new Error(`fixture not translated: ${JSON.stringify(w.result)}`);
  return { translation: w.result, ir: w.ir };
}

const DEFAULT: EquivBounds = DEFAULT_STEPS[DEFAULT_STEPS.length - 1]!;

const z3: Z3Driver | null = (await openSystemZ3()) ?? (await openWasmZ3());
let sandbox: Sandbox;
beforeAll(async () => {
  sandbox = await Sandbox.open();
});
const log: string[] = [];
const note = (what: string, r: { status: string; unroll: number; coverage?: unknown; reason?: string; ms: number }): void => {
  log.push(`${what}: ${r.status} at U=${r.unroll} coverage=${JSON.stringify(r.coverage ?? null)} ${Math.round(r.ms)} ms${r.reason ? ` (${r.reason.slice(0, 160)})` : ''}`);
};
afterAll(async () => {
  console.log(`coverage regressions (${z3?.kind} z3 ${z3?.version}):\n${log.join('\n')}`);
  await sandbox?.close();
  expect(liveSandboxWorkers()).toBe(0);
});

async function differs(o: FnUnderTest, c: FnUnderTest, input: Val[]): Promise<boolean> {
  const [ro, rc] = await runInstrumented([o.translation, c.translation], [input], { sandbox });
  const a = ro![0]!;
  const b = rc![0]!;
  return (a.tag === 'ok' || a.tag === 'throw') && b.tag !== 'fault' && !outcomeEqual(a, b);
}

// a fixed 12-iteration loop: every input needs more than U = 10 iterations
const FIXED_O = fn('export function f(a: number): number { let s = 0; for (let i = 0; i < 12; i++) { s += 1; } return a + s; }');
const FIXED_C = fn('export function f(a: number): number { return a; }');
// a loop over s.length + 5: strings of length 6..8 (inside the string bound 8) need 11..13 iterations
const LEN_O = fn('export function f(s: string): number { let r = 0; for (let i = 0; i < s.length + 5; i++) { r = r + 1; } return r; }');
const LEN_C = fn('export function f(s: string): number { return s.length > 5 ? 0 : s.length + 5; }');
// an index loop over a concat: up to 12 iterations at arrays 6
const CAT_O = fn('export function f(xs: number[], ys: number[]): number { const zs = xs.concat(ys); let s = 0; for (let i = 0; i < zs.length; i++) { s = s + zs[i]; } return s; }');
const CAT_C = fn('export function f(xs: number[], ys: number[]): number { const zs = xs.concat(ys); let s = 0; for (let i = 0; i < zs.length; i++) { s = s + zs[i]; } return zs.length >= 11 ? s + 1 : s; }');
// the original leaves the model (2^53 + 1) on every input
const OVF_O = fn('export function f(a: number): number { return 9007199254740992 + 1 + a; }');
const OVF_C = fn('export function f(a: number): number { return a * 7; }');
// an integer-driven loop: the documented caveat (n >= 13 needs more than U = 10 iterations)
const INT_O = fn('export function f(n: number): number { return 0; }');
const INT_C = fn('export function f(n: number): number { for (let i = 0; i < n; i++) { if (i === 12) { return 1; } } return 0; }');

describe.skipIf(!z3)('coverage of an unsat answer (red-team round 1 regressions)', () => {
  it('V1: a pair whose every input needs more than U iterations is not unsat (vacuous), and verifiedToK finds the difference at a raised U', async () => {
    expect(await differs(FIXED_O, FIXED_C, [3])).toBe(true);
    const r = await checkEquivalent(FIXED_O, FIXED_C, { array: 2, string: 2, int: 20, unroll: 10 }, 60_000, z3!, { sandbox });
    note('fixed-12 loop, checkEquivalent U=10', r);
    expect(r.status).toBe('unknown');
    expect(r.coverage).toEqual({ kind: 'vacuous', fuel: true });
    expect(r.reason).toMatch(/^vacuous: /);
    const v = await verifiedToK(FIXED_O, FIXED_C, { budgetMs: 120_000, z3: z3!, sandbox });
    note(`fixed-12 loop, verifiedToK [${v.attempts.map((a) => `${a.status}@U${a.unroll}`).join(',')}]`, v.result);
    expect(v.result.status).toBe('sat');
    expect(v.result.unroll).toBeGreaterThan(12);
    expect(v.result.encodingNote).toContain(`${v.result.unroll} iterations`);
    expect(v.detail?.result).toBe('sat');
    expect(outcomeEqual(v.result.counterexample!.original, v.result.counterexample!.candidate)).toBe(false);
  }, 180_000);

  it('V1 without fuel: an original that leaves the model on every input is not unsat', async () => {
    const r = await checkEquivalent(OVF_O, OVF_C, { array: 2, string: 2, int: 6, unroll: 8 }, 60_000, z3!, { sandbox });
    note('literal overflow, checkEquivalent', r);
    expect(r.status).toBe('unknown');
    expect(r.coverage).toEqual({ kind: 'vacuous', fuel: false });
    const v = await verifiedToK(OVF_O, OVF_C, { budgetMs: 60_000, z3: z3!, sandbox });
    expect(v.result.status).not.toBe('unsat');
    expect(v.detail?.result).not.toBe('unsat');
    expect(v.detail?.k).toBe(0);
  }, 120_000);

  it('partial exclusion by size: strings inside the bound that need more than U iterations make the answer unknown, never unsat', async () => {
    expect(await differs(LEN_O, LEN_C, ['aaaaaa'])).toBe(true);
    const r = await checkEquivalent(LEN_O, LEN_C, DEFAULT, 60_000, z3!, { sandbox });
    note('length+5 loop, checkEquivalent default', r);
    expect(r.status).toBe('unknown');
    expect(r.coverage?.kind).toBe('size-driven');
    const ex = r.coverage!.example![0] as string;
    log.push(`  size-driven example as code units: [${[...ex].map((ch) => ch.charCodeAt(0)).join(', ')}]`);
    expect(ex.length).toBeGreaterThanOrEqual(6);
    expect(ex.length).toBeLessThanOrEqual(DEFAULT.string);
    const v = await verifiedToK(LEN_O, LEN_C, { budgetMs: 120_000, z3: z3!, sandbox });
    note(`length+5 loop, verifiedToK [${v.attempts.map((a) => `${a.status}@U${a.unroll}`).join(',')}]`, v.result);
    expect(v.result.status).toBe('sat');
    expect(v.result.unroll).toBeGreaterThan(DEFAULT.unroll);
  }, 180_000);

  it('arrays: an index loop over a concat (12 iterations at arrays 6) is never "Verified to 6" while [[1..6],[1..5]] differs', async () => {
    const w: Val[] = [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5]];
    expect(await differs(CAT_O, CAT_C, w)).toBe(true);
    const r = await checkEquivalent(CAT_O, CAT_C, DEFAULT, 60_000, z3!, { sandbox });
    note('concat index loop, checkEquivalent default', r);
    expect(r.status).toBe('unknown');
    expect(r.coverage?.kind).toBe('size-driven');
    const v = await verifiedToK(CAT_O, CAT_C, { budgetMs: 180_000, z3: z3!, sandbox });
    note(`concat index loop, verifiedToK [${v.attempts.map((a) => `${a.status}@U${a.unroll}`).join(',')}]`, v.result);
    expect(v.result.status).toBe('sat');
    expect(outcomeEqual(v.result.counterexample!.original, v.result.counterexample!.candidate)).toBe(false);
    // every unsat attempt on the way covered its bounds (no size-driven exclusion behind it)
    for (const a of v.attempts.filter((x) => x.status === 'unsat')) expect(a.coverage?.kind).toBe('full');
  }, 300_000);

  it('integer-driven exclusion (the documented caveat) stays unsat and says so, with an example', async () => {
    const r = await checkEquivalent(INT_O, INT_C, { array: 1, string: 1, int: 20, unroll: 10 }, 60_000, z3!, { sandbox });
    note('integer-driven loop, checkEquivalent', r);
    expect(r.status).toBe('unsat');
    expect(r.coverage?.kind).toBe('int-driven');
    const n = r.coverage!.example![0] as number;
    expect(Math.abs(n)).toBeGreaterThanOrEqual(10);
    expect(r.encodingNote).toContain('10 iterations');
    expect(r.encodingNote).toContain('SOME INPUTS INSIDE THESE BOUNDS WERE EXCLUDED');
    expect(r.encodingNote).toContain(JSON.stringify(r.coverage!.example));
  }, 120_000);

  it('a pair with no loop reaching U reports full coverage', async () => {
    const o = fn('export function f(xs: number[]): number { let s = 0; for (const x of xs) { s += x; } return s; }');
    const c = fn('export function f(xs: number[]): number { return xs.reduce((a, x) => a + x, 0); }');
    const r = await checkEquivalent(o, c, DEFAULT, 60_000, z3!, { sandbox });
    note('for-of vs reduce, checkEquivalent default', r);
    expect(r.status).toBe('unsat');
    expect(r.coverage).toEqual({ kind: 'full' });
    expect(r.encodingNote).toContain('no input inside the bounds was excluded');
  }, 120_000);

  it('V3: a deep unrolling (U = 520) returns a result instead of throwing a JavaScript stack overflow', async () => {
    const o = fn('export function f(n: number): number { return n <= 0 ? 0 : n; }');
    const c = fn('export function f(n: number): number { if (n <= 0) { return 0; } return 1 + f(n - 1); }');
    const r = await checkEquivalent(o, c, { array: 1, string: 1, int: 520, unroll: 520 }, 120_000, z3!, { sandbox });
    note('depth check at U=520', r);
    expect(['sat', 'unknown', 'timeout']).toContain(r.status);
    if (r.status === 'unknown') expect(r.reason ?? '').toMatch(/stack|did not complete/);
    if (r.status === 'sat') expect(r.counterexample!.candidate).toMatchObject({ tag: 'range-violation' });
  }, 300_000);
});
