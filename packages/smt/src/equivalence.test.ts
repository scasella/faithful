/**
 * The bounded SMT tier on known pairs: known-different pairs must be `sat` with a counterexample confirmed by replay in
 * the sandbox; known-equal pairs must be `unsat`; the adaptive driver must respect its budget and never claim a k that
 * did not complete. Both Z3 drivers (WASM and system) run every pair.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, liveSandboxWorkers, outcomeEqual } from '@faithful/engine';
import { translateWithIr } from '@faithful/translate';
import { DEFAULT_STEPS, checkEquivalent, verifiedToK, type EquivBounds, type FnUnderTest } from './equivalence.js';
import { openSystemZ3, openWasmZ3, type SmtResult, type Z3Driver } from './z3.js';

function fn(source: string, name: string): FnUnderTest {
  const w = translateWithIr(source, name);
  if (!w.result.ok || !w.ir) throw new Error(`fixture ${name} not translated: ${JSON.stringify(w.result)}`);
  return { translation: w.result, ir: w.ir };
}

const DEFAULT: EquivBounds = DEFAULT_STEPS[DEFAULT_STEPS.length - 1]!;

// ───────────── known-different pairs ─────────────

const DIFFERENT: Array<{ name: string; original: FnUnderTest; candidate: FnUnderTest; bounds?: EquivBounds }> = [
  {
    name: 'off-by-one loop bound',
    original: fn(`export function sumBelow(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s = s + i; } return s; }`, 'sumBelow'),
    candidate: fn(`export function sumBelow(n: number): number { let s = 0; for (let i = 0; i <= n; i++) { s = s + i; } return s; }`, 'sumBelow'),
  },
  {
    name: 'wrong comparison',
    original: fn(`export function countAbove(xs: number[], t: number): number { return xs.filter((x) => x > t).length; }`, 'countAbove'),
    candidate: fn(`export function countAbove(xs: number[], t: number): number { return xs.filter((x) => x >= t).length; }`, 'countAbove'),
  },
  {
    name: 'missing case',
    original: fn(`export function sign(n: number): number { if (n < 0) { return -1; } if (n === 0) { return 0; } return 1; }`, 'sign'),
    candidate: fn(`export function sign(n: number): number { if (n < 0) { return -1; } return 1; }`, 'sign'),
  },
  {
    name: 'overflow-only difference (candidate leaves ±2^53 where the original does not)',
    original: fn(`export function triple(a: number): number { return a * 3; }`, 'triple'),
    candidate: fn(`export function triple(a: number): number { return a * 1000000000000 * 3 - a * 999999999999 * 3; }`, 'triple'),
  },
  {
    name: 'empty-array case',
    original: fn(`export function firstOr(xs: number[]): number { return xs.length === 0 ? -1 : xs[0]; }`, 'firstOr'),
    candidate: fn(`export function firstOr(xs: number[]): number { return xs.length > 0 ? xs[0] : 0; }`, 'firstOr'),
  },
  {
    name: 'different thrown message',
    original: fn(`export function need(n: number): number { if (n < 0) { throw new Error("negative"); } return n; }`, 'need'),
    candidate: fn(`export function need(n: number): number { if (n < 0) { throw new Error("must be >= 0"); } return n; }`, 'need'),
  },
  {
    name: 'string: case of the first letter',
    original: fn(`export function cap(s: string): string { return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1); }`, 'cap'),
    candidate: fn(`export function cap(s: string): string { return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(2); }`, 'cap'),
  },
  {
    name: 'unstable vs stable order is invisible, but descending vs ascending is not',
    original: fn(`export function byY(ps: { x: number; y: number }[]): { x: number; y: number }[] { return ps.slice().sort((a, b) => a.y - b.y); }`, 'byY'),
    candidate: fn(`export function byY(ps: { x: number; y: number }[]): { x: number; y: number }[] { return ps.slice().sort((a, b) => b.y - a.y); }`, 'byY'),
  },
];

// ───────────── known-equal pairs ─────────────

const EQUAL: Array<{ name: string; original: FnUnderTest; candidate: FnUnderTest; bounds?: EquivBounds }> = [
  {
    name: 'iterative vs recursive fib (small unrolling bound)',
    original: fn(
      `export function fib(n: number): number {
        if (n < 0) { throw new Error("negative"); }
        let a = 0; let b = 1;
        for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t; }
        return a;
      }`,
      'fib',
    ),
    candidate: fn(
      `export function fib(n: number): number {
        if (n < 0) { throw new Error("negative"); }
        if (n < 2) { return n; }
        return fib(n - 1) + fib(n - 2);
      }`,
      'fib',
    ),
  },
  {
    name: 'sum via loop vs reduce',
    original: fn(`export function total(xs: number[]): number { let s = 0; for (const x of xs) { s += x; } return s; }`, 'total'),
    candidate: fn(`export function total(xs: number[]): number { return xs.reduce((acc, x) => acc + x, 0); }`, 'total'),
  },
  {
    name: 'algebraically equal forms',
    original: fn(`export function sq(a: number, b: number): number { return (a + b) * (a + b); }`, 'sq'),
    candidate: fn(`export function sq(a: number, b: number): number { return a * a + 2 * a * b + b * b; }`, 'sq'),
  },
  {
    name: 'floor division and remainder recombine',
    original: fn(`export function id(n: number, d: number): number { if (d <= 0) { throw new Error("d"); } return n; }`, 'id'),
    candidate: fn(
      `export function id(n: number, d: number): number { if (d <= 0) { throw new Error("d"); } return Math.floor(n / d) * d + (n - Math.floor(n / d) * d); }`,
      'id',
    ),
  },
  {
    name: 'string reverse: loop vs split/join-free recursion',
    original: fn(
      `export function rev(s: string): string { let out = ""; for (let i = s.length - 1; i >= 0; i--) { out = out + s.charAt(i); } return out; }`,
      'rev',
    ),
    candidate: fn(`export function rev(s: string): string { if (s === "") { return ""; } return rev(s.slice(1)) + s.charAt(0); }`, 'rev'),
  },
  {
    name: 'count via filter vs loop',
    original: fn(`export function evens(xs: number[]): number { return xs.filter((x) => x % 2 === 0).length; }`, 'evens'),
    candidate: fn(`export function evens(xs: number[]): number { let c = 0; for (let i = 0; i < xs.length; i++) { if (xs[i] % 2 === 0) { c++; } } return c; }`, 'evens'),
  },
];

const drivers = [
  ['wasm', openWasmZ3],
  ['system', openSystemZ3],
] as const;

const timings: string[] = [];

let sandbox: Sandbox;
beforeAll(async () => {
  sandbox = await Sandbox.open();
});
afterAll(async () => {
  await sandbox?.close();
  expect(liveSandboxWorkers()).toBe(0);
  console.log(`SMT equivalence timings (${new Date().toISOString()}, Node ${process.version}, default k: arrays ${DEFAULT.array}, strings ${DEFAULT.string}, ints ±${DEFAULT.int}, U=${DEFAULT.unroll}):\n${timings.join('\n')}`);
});

describe.each(drivers)('bounded equivalence (%s z3)', (kind, open) => {
  let z3: Z3Driver | null;
  beforeAll(async () => {
    z3 = await open();
  });

  it.each(DIFFERENT.map((p) => [p.name, p] as const))('known-different: %s is sat with a replay-confirmed counterexample', async (_n, p) => {
    if (!z3) return;
    const r = await checkEquivalent(p.original, p.candidate, p.bounds ?? DEFAULT, 120_000, z3, { sandbox });
    timings.push(`${kind} different "${p.name}": ${r.status} in ${Math.round(r.ms)} ms (z3 ${Math.round(r.solveMs)} ms, ${r.smtChars} chars)`);
    expect(r.status, r.reason).toBe('sat');
    const cex = r.counterexample!;
    // the outcomes in the result are the replayed ones, and they differ
    expect(outcomeEqual(cex.original, cex.candidate)).toBe(false);
    expect(cex.original.tag === 'ok' || cex.original.tag === 'throw').toBe(true);
    expect(cex.candidate.tag).not.toBe('fault');
    expect(r.k).toBe(Math.min(r.bounds.array, r.bounds.string));
    expect(r.encodingNote).toContain(`${r.unroll} iterations`);
  }, 180_000);

  it.each(EQUAL.map((p) => [p.name, p] as const))('known-equal: %s is unsat', async (_n, p) => {
    if (!z3) return;
    const r = await checkEquivalent(p.original, p.candidate, p.bounds ?? DEFAULT, 120_000, z3, { sandbox });
    timings.push(`${kind} equal "${p.name}": ${r.status} in ${Math.round(r.ms)} ms (z3 ${Math.round(r.solveMs)} ms, ${r.smtChars} chars)`);
    expect(r.status, `${r.reason ?? ''} ${JSON.stringify(r.counterexample ?? null)}`).toBe('unsat');
    expect(r.counterexample).toBeUndefined();
  }, 180_000);

  it('the overflow-only pair: adaptive k stays unsat while ±2^8 cannot overflow, and turns sat when ±2^12 can', async () => {
    if (!z3) return;
    const p = DIFFERENT[3]!;
    const v = await verifiedToK(p.original, p.candidate, { budgetMs: 120_000, z3, sandbox });
    expect(v.attempts.map((a) => a.status)).toEqual(['unsat', 'unsat', 'sat']);
    expect(v.result.status).toBe('sat');
    expect(v.result.bounds.int).toBe(4096);
    expect(v.detail?.result).toBe('sat');
    expect(v.result.counterexample!.candidate.tag).toBe('range-violation');
  }, 300_000);

  it('a known-equal pair is verified to the default k (arrays 6, strings 8, integers ±2^16)', async () => {
    if (!z3) return;
    const p = EQUAL[1]!;
    const v = await verifiedToK(p.original, p.candidate, { budgetMs: 120_000, z3, sandbox });
    expect(v.result.status).toBe('unsat');
    expect(v.result.bounds).toEqual({ array: 6, string: 8, int: 65536 });
    expect(v.detail).toMatchObject({ stage: 'smt', k: 6, result: 'unsat', bounds: { array: 6, string: 8, int: 65536 } });
    expect(v.detail!.encoding).toContain('at most 6 elements');
    expect(v.detail!.encoding).toContain('10 iterations');
  }, 300_000);
});

// ───────────── budget enforcement ─────────────

/** a^3 + b^3 = c^3 has no positive solution (Fermat, n = 3); Z3 cannot show that quickly. */
const HARD_O = fn(
  `export function fermat(a: number, b: number, c: number): number { return a > 0 && b > 0 && c > 0 && a * a * a + b * b * b === c * c * c ? 1 : 0; }`,
  'fermat',
);
const HARD_C = fn(`export function fermat(a: number, b: number, c: number): number { return 0; }`, 'fermat');

describe.each(drivers)('budget (%s z3)', (_kind, open) => {
  it('a hard query returns timeout within the budget; k is the last completed bound (0 when none)', async () => {
    const z3 = await open();
    if (!z3) return;
    const budget = 3_000;
    const steps: EquivBounds[] = [{ array: 2, string: 2, int: 2 ** 4, unroll: 2 }, { array: 4, string: 4, int: 2 ** 17, unroll: 2 }];
    const t0 = Date.now();
    const v = await verifiedToK(HARD_O, HARD_C, { budgetMs: budget, z3, sandbox, steps });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(budget + 4_000); // the system driver rounds its -T: up to whole seconds, + kill grace
    const last = v.attempts[v.attempts.length - 1]!;
    expect(['timeout', 'unknown']).toContain(last.status);
    const completed = v.attempts.filter((a) => a.status === 'unsat');
    expect(v.result.k).toBe(completed.length ? completed[completed.length - 1]!.k : 0);
    if (completed.length) {
      expect(v.result.status).toBe('unsat');
      expect(v.detail!.encoding).toContain('did not complete');
    } else {
      expect(v.detail!.encoding).toContain('No bound completed');
    }
  }, 60_000);
});

describe('adaptive k with a driver that stops answering above the first bound', () => {
  it('reports the largest completed k and its status, never the attempted one', async () => {
    const real = (await openSystemZ3()) ?? (await openWasmZ3());
    if (!real) return;
    let calls = 0;
    const flaky: Z3Driver = {
      kind: real.kind,
      version: real.version,
      info: () => real.info(),
      solve: async (s, o): Promise<SmtResult> => (++calls === 1 ? real.solve(s, o) : { status: 'timeout', output: '', ms: o.timeoutMs, kind: real.kind }),
    };
    const p = EQUAL[1]!;
    const v = await verifiedToK(p.original, p.candidate, { budgetMs: 60_000, z3: flaky, sandbox });
    expect(v.attempts.map((a) => a.status)).toEqual(['unsat', 'timeout']);
    expect(v.result.status).toBe('unsat');
    expect(v.result.k).toBe(2);
    expect(v.detail).toMatchObject({ k: 2, result: 'unsat', bounds: { array: 2, string: 2, int: 16 } });
    expect(v.detail!.encoding).toContain('did not complete');
  }, 120_000);

  it('unsupported and signature mismatches are reported, not approximated', async () => {
    const z3 = (await openSystemZ3()) ?? (await openWasmZ3());
    if (!z3) return;
    const a = fn(`export function f(n: number): number { return n; }`, 'f');
    const b = fn(`export function f(n: number, m: number): number { return n; }`, 'f');
    const r = await checkEquivalent(a, b, DEFAULT, 10_000, z3, { sandbox });
    expect(r.status).toBe('unsupported');
    expect(r.reason).toMatch(/^unsupported: parameter types differ/);
    const v = await verifiedToK(a, b, { budgetMs: 10_000, z3, sandbox });
    expect(v.detail).toBeNull();
  });
});
