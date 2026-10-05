import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Val } from '@faithful/translate';
import { Sandbox } from '../sandbox/sandbox.js';
import { enumerateCandidates, generateMutants } from './mutate.js';
import { deriveInputs, paramTys } from './inputs.js';
import { mutationCheck, summarize, type MutantResult } from './check.js';
import { mulberry32 } from '../benchmark/rng.js';

const SUM_POS = `export function sumPositive(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] > 0) s += xs[i];
  }
  return s;
}`;

const CLAMP = `export function clamp(x: number, lo: number, hi: number): number {
  if (lo > hi) throw new Error("empty range");
  return x < lo ? lo : x > hi ? hi : x;
}`;

const GREET = `export function greet(name: string, loud: boolean): string {
  const base = "hi " + name;
  return loud ? base.toUpperCase() : base;
}`;

/** abs written so that `x < 0` -> `x <= 0` is an equivalent mutant (-0 and 0 are the same Val). */
const ABS = `export function abs(x: number): number {
  if (x < 0) return -x;
  return x;
}`;

function ints(rng: () => number, n: number, lo: number, hi: number): number[] {
  return Array.from({ length: n }, () => lo + Math.floor(rng() * (hi - lo + 1)));
}

describe('mutant generation', () => {
  it('finds the documented kinds and never mutates type annotations', () => {
    const cands = enumerateCandidates(SUM_POS, 'sumPositive');
    const kinds = new Set(cands.map((c) => c.kind));
    for (const k of ['arithmetic', 'comparison', 'constant', 'negate-condition', 'loop-bound', 'remove-statement'] as const) {
      expect(kinds.has(k)).toBe(true);
    }
    // number[] / : number never touched
    for (const c of cands) expect(c.original.includes('number')).toBe(false);
  });

  it('does not swap + on strings, and offers return-variable only for type-compatible variables', () => {
    const cands = enumerateCandidates(GREET, 'greet');
    expect(cands.some((c) => c.kind === 'arithmetic')).toBe(false);
    const rv = cands.filter((c) => c.kind === 'return-variable').map((c) => c.mutated);
    expect(rv).toEqual(['base', 'name']);
    expect(cands.some((c) => c.kind === 'swap-branches')).toBe(true);
  });

  it('never removes the final return or a declaration', () => {
    const cands = enumerateCandidates(SUM_POS, 'sumPositive').filter((c) => c.kind === 'remove-statement');
    for (const c of cands) {
      expect(c.original.startsWith('return s')).toBe(false);
      expect(c.original.startsWith('let ')).toBe(false);
    }
  });

  it('is deterministic given the seed and varies with it', () => {
    const a = generateMutants(SUM_POS, 'sumPositive', { seed: 7, max: 12 }).mutants.map((m) => m.id);
    const b = generateMutants(SUM_POS, 'sumPositive', { seed: 7, max: 12 }).mutants.map((m) => m.id);
    const c = generateMutants(SUM_POS, 'sumPositive', { seed: 8, max: 12 }).mutants.map((m) => m.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    expect(c).not.toEqual(a);
  });

  it('reads parameter types and derives typed, deterministic second-pass inputs', () => {
    expect(paramTys(CLAMP, 'clamp')).toEqual([{ k: 'int' }, { k: 'int' }, { k: 'int' }]);
    const tys = paramTys(SUM_POS, 'sumPositive')!;
    const x = deriveInputs(tys, [[[1, 2, 3]], [[-4, 0]]], 50, mulberry32(1));
    const y = deriveInputs(tys, [[[1, 2, 3]], [[-4, 0]]], 50, mulberry32(1));
    expect(x).toEqual(y);
    for (const [arr] of x as Array<[number[]]>) {
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeLessThanOrEqual(10);
      for (const v of arr) expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('report buckets', () => {
  const base = { kind: 'arithmetic' as const, line: 1, column: 1, original: '+', mutated: '-' };
  it('throws when results do not account for every drawn mutant', () => {
    const rs: MutantResult[] = [{ id: 'a', ...base, fate: { status: 'not-distinguished', inputs: 10 } }];
    expect(() => summarize(rs, 2)).toThrow(/do not add up/);
  });
  it('never counts not-distinguished or time-limit mutants as caught', () => {
    const rs: MutantResult[] = [
      { id: 'a', ...base, fate: { status: 'caught', pass: 1, input: [1], original: { tag: 'ok', value: 1 }, mutant: { tag: 'ok', value: 2 } } },
      { id: 'b', ...base, fate: { status: 'not-distinguished', inputs: 1200 } },
      { id: 'c', ...base, fate: { status: 'caught-by-time-limit', pass: 1, input: [1], perCallMs: 100 } },
      { id: 'd', ...base, fate: { status: 'stillborn', error: 'x' } },
    ];
    const s = summarize(rs, 4);
    expect(s.caught).toBe(1);
    expect(s.total).toBe(3);
    expect(s.summary).toBe(
      '1 of 3 broken copies caught (1 more stopped only by the time limit; 1 not distinguished by 1,200 inputs; 1 did not load)',
    );
  });
});

describe('mutationCheck in the sandbox', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });

  it('catches broken copies of sumPositive and is deterministic for a seed', async () => {
    const rng = mulberry32(3);
    const inputs: Val[][] = Array.from({ length: 200 }, () => [ints(rng, Math.floor(rng() * 8), -20, 20)]);
    const r1 = await mutationCheck(SUM_POS, 'sumPositive', inputs, { seed: 1, max: 12, sandbox: sb });
    const r2 = await mutationCheck(SUM_POS, 'sumPositive', inputs, { seed: 1, max: 12, sandbox: sb });
    expect(r1.total + r1.stillborn).toBe(12);
    expect(r1.mutants.map((m) => [m.id, m.fate.status])).toEqual(r2.mutants.map((m) => [m.id, m.fate.status]));
    expect(r1.caught).toBeGreaterThan(0);
    expect(r1.summary).toMatch(/^\d+ of \d+ broken copies caught/);
    console.log(`sumPositive seed 1: ${r1.summary}; sites ${r1.sites}; ${r1.ms} ms`);
  });

  it('weak inputs: what pass 1 misses, the larger second pass can catch, and it is tagged pass 2', async () => {
    // Only non-negative inputs: x < lo / x > hi branches mostly unexercised with these three inputs.
    const inputs: Val[][] = [[5, 0, 10]];
    const r = await mutationCheck(CLAMP, 'clamp', inputs, { seed: 2, max: 12, sandbox: sb });
    expect(r.caughtSecondPass).toBeGreaterThan(0);
    for (const m of r.mutants) if (m.fate.status === 'caught' && m.fate.pass === 2) expect(r.inputs.secondPass).toBeGreaterThan(0);
    console.log(`clamp seed 2 (1 given input): ${r.summary}; first pass ${r.caughtFirstPass}, second pass ${r.caughtSecondPass}`);
  });

  it('reports an equivalent mutant as not distinguished, never as caught', async () => {
    const inputs: Val[][] = [[-3], [0], [4], [-1], [7]];
    const r = await mutationCheck(ABS, 'abs', inputs, { seed: 3, max: 40, sandbox: sb });
    const eq = r.mutants.find((m) => m.kind === 'comparison' && m.mutated === '<=');
    expect(eq?.fate.status).toBe('not-distinguished');
    if (eq?.fate.status === 'not-distinguished') expect(eq.fate.inputs).toBe(r.inputs.firstPass + r.inputs.secondPass);
    expect(r.summary).toMatch(/not distinguished by [\d,]+ inputs/);
    console.log(`abs seed 3: ${r.summary}`);
  });

  it('greet: string function', async () => {
    const inputs: Val[][] = [['ann', true], ['bob', false], ['', true], ['Zed', false]];
    const r = await mutationCheck(GREET, 'greet', inputs, { seed: 4, max: 12, sandbox: sb });
    expect(r.total).toBeGreaterThan(0);
    console.log(`greet seed 4: ${r.summary}`);
  });

  it('excludes inputs outside the precondition via the instrumented original and accept()', async () => {
    const SQ = `export function sq(x: number): number { return x * x; }`;
    const INST = `export function sq(x: number): number { return __faithfulInt(x * x, "x * x"); }`;
    const r = await mutationCheck(SQ, 'sq', [[3], [2 ** 40], [-2]], { seed: 5, max: 4, sandbox: sb, instrumentedTs: INST, accept: (a) => a[0] !== -2 });
    expect(r.inputs.firstPass).toBe(1);
    expect(r.inputs.excluded.rangeViolation).toBeGreaterThanOrEqual(1);
    expect(r.inputs.excluded.rejected).toBeGreaterThanOrEqual(1);
  });

  it('a mutant that loops forever is caught by the time limit, not counted in k', async () => {
    const LOOP = `export function count(n: number): number {
  let c = 0;
  let i = 0;
  while (i < n) { i = i + 1; c = c + 2; }
  return c;
}`;
    const r = await mutationCheck(LOOP, 'count', [[3], [5], [0]], { seed: 6, max: 30, sandbox: sb, perCallMs: 50, secondPassInputs: 50 });
    const loopers = r.mutants.filter((m) => m.fate.status === 'caught-by-time-limit');
    expect(r.caughtByTimeLimit).toBe(loopers.length);
    expect(r.caught + r.caughtByTimeLimit + r.notDistinguished).toBe(r.total);
    console.log(`count seed 6: ${r.summary}`);
  }, 120_000);
});
