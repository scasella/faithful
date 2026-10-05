/** The Tested-only path's engine pieces: signature inference, the float-aware generator, the 'js' sandbox domain, jsVsJs. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Val } from '@faithful/translate';
import { Sandbox } from '../sandbox/sandbox.js';
import { mutationCheck } from '../mutation/check.js';
import { purityGate } from '../gates/purity.js';
import { bench } from '../benchmark/bench.js';
import { mulberry32 } from '../benchmark/rng.js';
import { generateSignatureInputs, inferSignature, signatureWords, sizedValue, type FunctionSignature } from './signature.js';
import { decodeJs, differsOnlyInZeroSign, encodeJs, jsOutcomeEqual, jsValEqual, showJs, special } from './jsvalues.js';
import { jsVsJs, screenOriginal } from './jsdifferential.js';

const AVERAGE = `/** Mean. */
export function average(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error('average of empty list');
  }
  let sum = 0;
  for (const x of xs) {
    sum = sum + x;
  }
  return sum / xs.length;
}
`;

const sig = (src: string, fn: string): FunctionSignature => {
  const r = inferSignature(src, fn);
  if (!r.ok) throw new Error(r.reason);
  return r.sig;
};
const refusal = (src: string, fn: string): string => {
  const r = inferSignature(src, fn);
  if (r.ok) throw new Error(`expected a refusal, got ${signatureWords(r.sig)}`);
  return r.reason;
};

describe('inferSignature', () => {
  it('reads plain, readonly, optional, defaulted, aliased, literal-union and nullable parameters', () => {
    expect(signatureWords(sig(AVERAGE, 'average'))).toBe('average(xs: array of number)');
    const src = `
      type P = { x: number; label?: string };
      interface Q { tags: readonly string[]; pair: [number, boolean] }
      export function f(a: readonly number[], p: P, q: Q, mode: 'up' | 'down', n: number | null, k?: number, z = 3): number { return 0; }
    `;
    const s = sig(src, 'f');
    expect(s.params.map((p) => p.ty.k)).toEqual(['array', 'record', 'record', 'literal', 'nullable', 'number', 'number']);
    expect(s.params.map((p) => p.optional)).toEqual([false, false, false, false, false, true, true]);
    expect(signatureWords(s)).toBe(
      'f(a: array of number, p: { x: number, label?: string }, q: { tags: array of string, pair: [number, boolean] }, mode: "up" | "down", n: number or null, k?: number, z?: number)',
    );
  });

  it('refuses what it cannot generate, in plain words', () => {
    expect(refusal('export function g<T>(x: T): T { return x; }', 'g')).toMatch(/generic.*type parameter T/);
    expect(refusal('export function g(f: (x: number) => number): number { return f(1); }', 'g')).toMatch(/parameter f is a function/);
    expect(refusal('class C { v = 1 } export function g(c: C): number { return c.v; }', 'g')).toMatch(/instance of class C/);
    expect(refusal('export function g(d: Date): number { return 0; }', 'g')).toMatch(/is a Date/);
    expect(refusal('export function g(m: Map<string, number>): number { return 0; }', 'g')).toMatch(/is a Map/);
    expect(refusal('export function g(x: any): number { return 0; }', 'g')).toMatch(/typed any/);
    expect(refusal('export function g(x: unknown): number { return 0; }', 'g')).toMatch(/typed unknown/);
    expect(refusal('export function g(x: Record<string, number>): number { return 0; }', 'g')).toMatch(/dictionary/);
    expect(refusal('export function g(x: number | string): number { return 0; }', 'g')).toMatch(/union of several types/);
    expect(refusal('export function g(...xs: number[]): number { return 0; }', 'g')).toMatch(/rest parameter/);
    expect(refusal('export function g(x: { $faithful: number }): number { return 0; }', 'g')).toMatch(/\$faithful/);
    expect(refusal('export function g(x: { f(): number }): number { return 0; }', 'g')).toMatch(/method/);
    expect(refusal('export function g(x: number): number { return 0; }', 'h')).toMatch(/no function/);
  });
});

describe('generateSignatureInputs', () => {
  const s = sig(AVERAGE, 'average');
  it('is deterministic, boundary-first, and mixes integers with non-integer doubles', () => {
    const a = generateSignatureInputs(s, { n: 400, seed: 7 });
    const b = generateSignatureInputs(s, { n: 400, seed: 7 });
    expect(a.inputs).toEqual(b.inputs);
    expect(a.inputs.length).toBe(400);
    expect(a.inputs[0]).toEqual([[]]);
    // non-integer inputs come from the boundary set already (not only by luck of the random part)
    const firstThird = a.inputs.slice(0, 133);
    expect(firstThird.some((args) => (args[0] as number[]).some((x) => typeof x === 'number' && !Number.isInteger(x)))).toBe(true);
    expect(a.nonIntegerInputs).toBeGreaterThan(100);
    expect(a.inputs.some((args) => (args[0] as number[]).some((x) => Number.isInteger(x) && x !== 0))).toBe(true);
    expect(a.specialInputs).toBe(0);
    expect(JSON.stringify(a.inputs)).not.toContain('$faithful');
  });
  it('generates NaN, Infinity and -0 only when asked, labeled and counted, with -0 distinct from 0', () => {
    const a = generateSignatureInputs(s, { n: 400, seed: 7, specials: true });
    expect(a.specialInputs).toBeGreaterThan(5);
    const text = JSON.stringify(a.inputs);
    for (const n of ['NaN', 'Infinity', '-Infinity', '-0']) expect(text).toContain(`{"$faithful":"${n}"}`);
    expect(a.inputs.some((x) => JSON.stringify(x) === JSON.stringify([[special('-0'), 0]]))).toBe(true);
  });
  it('optional parameters sometimes get undefined; literal unions only their members', () => {
    const t = sig("export function f(mode: 'a' | 'b', k?: number): number { return 0; }", 'f');
    const g = generateSignatureInputs(t, { n: 100, seed: 1 });
    expect(g.inputs.every((x) => x[0] === 'a' || x[0] === 'b')).toBe(true);
    expect(g.inputs.some((x) => JSON.stringify(x[1]) === JSON.stringify(special('undefined')))).toBe(true);
  });
  it('sized benchmark values are plain finite JSON', () => {
    const v = sizedValue(s.params[0]!.ty, 64, mulberry32(3)) as number[];
    expect(v.length).toBe(64);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
    expect(v.some((x) => !Number.isInteger(x))).toBe(true);
  });
});

describe('equality policy', () => {
  it('NaN equals NaN, -0 differs from 0, undefined differs from null', () => {
    expect(jsValEqual(encodeJs(NaN), encodeJs(NaN))).toBe(true);
    expect(jsValEqual(encodeJs(-0), encodeJs(0))).toBe(false);
    expect(jsValEqual(encodeJs(undefined), null)).toBe(false);
    expect(jsValEqual(encodeJs([1.5, { a: NaN }]), encodeJs([1.5, { a: NaN }]))).toBe(true);
    expect(differsOnlyInZeroSign({ tag: 'ok', value: encodeJs([-0, 1]) }, { tag: 'ok', value: [0, 1] })).toBe(true);
    expect(differsOnlyInZeroSign({ tag: 'ok', value: 1 }, { tag: 'ok', value: 2 })).toBe(false);
    expect(jsOutcomeEqual({ tag: 'throw', message: 'x' }, { tag: 'throw', message: 'x' })).toBe(true);
    expect(Object.is(decodeJs(encodeJs(-0)), -0)).toBe(true);
    expect(showJs(encodeJs([0.5, NaN, -0, undefined, 'a']))).toBe('[0.5, NaN, -0, undefined, "a"]');
  });
});

describe("sandbox 'js' value domain and the Tested differential", () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });

  it('carries non-integers and the sentinels both ways, matching jsvalues.ts; the subset domain still faults on 1.5', async () => {
    const src = 'export function id(x: number[]): unknown { return [x[0] / 2, 0 / 0, 1 / 0, -1 / 0, -0, undefined, x[1], x.length]; }';
    await sb.load('js1', src, 'id', { values: 'js' });
    const r = await sb.call('js1', [[3, special('NaN')]]);
    expect(r.outcome).toEqual({ tag: 'ok', value: encodeJs([1.5, NaN, Infinity, -Infinity, -0, undefined, NaN, 2]) });
    expect(r.violations).toEqual([]); // a decoded NaN argument is not reported as mutated
    await sb.load('sub1', src, 'id');
    expect((await sb.call('sub1', [[3, 1]])).outcome.tag).toBe('fault');
    await sb.unload('js1');
    await sb.unload('sub1');
  });

  it('catches a candidate that is wrong only on non-integer inputs (deterministically, from the boundary set)', async () => {
    const s = sig(AVERAGE, 'average');
    const gen = generateSignatureInputs(s, { n: 300, seed: 7001 });
    const truncating = AVERAGE.replace('sum = sum + x;', 'sum = sum + Math.trunc(x);');
    const rep = await jsVsJs({ source: AVERAGE, fnName: 'average' }, { source: truncating, fnName: 'average' }, gen.inputs, { sandbox: sb });
    expect(rep.differences.length).toBeGreaterThan(0);
    const d = rep.differences[0]!;
    expect((d.args[0] as Val[]).some((x) => typeof x === 'number' && !Number.isInteger(x))).toBe(true);
    // the same candidate agrees on every integer-only input: only the float-aware generator catches it
    const ints = gen.inputs.filter((a) => (a[0] as Val[]).every((x) => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) < 2 ** 53));
    const rep2 = await jsVsJs({ source: AVERAGE, fnName: 'average' }, { source: truncating, fnName: 'average' }, ints, { sandbox: sb });
    expect(rep2.differences).toEqual([]);
    // the empty list throws in both: compared as a throw with the same message
    const fast = `export function average(xs: number[]): number {\n  if (xs.length === 0) throw new Error('average of empty list');\n  let s = 0;\n  for (let i = 0; i < xs.length; i++) s += xs[i]!;\n  return s / xs.length;\n}\n`;
    const ok = await jsVsJs({ source: AVERAGE, fnName: 'average' }, { source: fast, fnName: 'average' }, gen.inputs, { sandbox: sb });
    expect(ok.differences).toEqual([]);
    expect(ok.compared).toBe(gen.inputs.length);
  });

  it('reports a difference only in the sign of zero as such', async () => {
    const orig = 'export function neg(x: number): number { return -x; }';
    const cand = 'export function neg(x: number): number { return 0 - x; }';
    const rep = await jsVsJs({ source: orig, fnName: 'neg' }, { source: cand, fnName: 'neg' }, [[0], [1.5]], { sandbox: sb });
    expect(rep.differences).toHaveLength(1);
    expect(rep.differences[0]!.zeroSignOnly).toBe(true);
  });

  it('screens, checks purity, runs the mutation check and benchmarks a float function in the js domain', async () => {
    const s = sig(AVERAGE, 'average');
    const gen = generateSignatureInputs(s, { n: 200, seed: 5, specials: true });
    const sc = await screenOriginal(sb, { source: AVERAGE, fnName: 'average' }, gen.inputs, 100);
    expect(sc.fast.length).toBe(200);
    const pu = await purityGate(sb, { id: 'pu', source: AVERAGE, fnName: 'average', sample: sc.fast.slice(0, 30), values: 'js' });
    expect(pu.ok).toBe(true);
    const mr = await mutationCheck(AVERAGE, 'average', sc.fast, { seed: 11, sandbox: sb, values: 'js', secondPassInputs: 100 });
    expect(mr.total).toBeGreaterThan(3);
    expect(mr.caught).toBeGreaterThan(2);
    const b = await bench(AVERAGE, 'average', { name: 'n doubles', sizes: [8, 16], gen: (n, rng) => [sizedValue(s.params[0]!.ty, n, rng)] }, { sandbox: sb, trials: 5, minTrialMs: 2, warmupMs: 10, values: 'js' });
    expect(b.pass.estimate).toBeGreaterThan(0);
  }, 60_000);
});
