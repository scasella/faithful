import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLeanDir } from '@faithful/core';
import { translate, type Translation, type Val } from '@faithful/translate';
import { Sandbox } from '../sandbox/sandbox.js';
import { compilePreconditions, generateInputs, SURROGATE_CASES } from './generate.js';
import { INSTRUMENTED_ENTRY, instrumentedSandboxSource, sandboxRuntime } from './instrumented.js';
import { outcomeEqual, tsVsLean, tsVsTs, valEqual, type LeanEvaluator } from './differential.js';
import { parseCorpusHeader } from './corpus.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;

// The engine does not depend on the prover; tests construct the evaluator from it (relative import, tests only).
async function leanEvaluator(): Promise<LeanEvaluator> {
  const { evalBatch } = await import('../../../prover/src/lean.js');
  return { evalBatch: (prelude, exprs, opts) => evalBatch(prelude, exprs, opts) };
}

function tr(src: string, fn: string): Translation {
  const t = translate(src, fn);
  if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal)}`);
  return t;
}

const FACT = `export function fact(n: number): number { if (n < 0) throw new Error("negative"); let p = 1; for (let i = 2; i <= n; i++) { p = p * i; } return p; }`;
const SHOUT = `export function shout(s: string): string { return s.toUpperCase(); }`;
const LOOP = `export function spin(n: number): number { let c = 0; for (let i = 0; i < n; i++) { c = c + 1; } return c; }`;
const STRS = `export function mix(s: string, xs: number[], b: boolean): string { return s + xs.length + b; }`;

describe('generateInputs (pure)', () => {
  const t = tr(STRS, 'mix');
  it('is deterministic per seed and differs across seeds', () => {
    const a = generateInputs(t, { n: 200, seed: 7 });
    const b = generateInputs(t, { n: 200, seed: 7 });
    const c = generateInputs(t, { n: 200, seed: 8 });
    expect(a.inputs).toEqual(b.inputs);
    expect(a.inputs).not.toEqual(c.inputs);
    expect(a.inputs.length).toBe(200);
    expect(new Set(a.inputs.map((x) => JSON.stringify(x))).size).toBe(200);
  });
  it('covers the boundary values and stays within the size parameters', () => {
    const g = generateInputs(t, { n: 400, seed: 1 });
    const ss = g.inputs.map((x) => x[0] as string);
    const xss = g.inputs.map((x) => x[1] as number[]);
    expect(ss).toContain('');
    expect(ss.some((s) => /[^\x00-\x7f]/.test(s))).toBe(true);
    expect(xss.some((xs) => xs.length === 0)).toBe(true);
    expect(xss.some((xs) => xs.length === 1)).toBe(true);
    const flat = xss.flat();
    for (const v of [0, -1, 9007199254740992, -9007199254740992, 9007199254740991, -9007199254740991]) expect(flat).toContain(v);
    expect(xss.some((xs) => xs.length >= 3 && xs.every((v, i) => i === 0 || xs[i - 1]! <= v) && new Set(xs).size < xs.length)).toBe(true);
    expect(Math.max(...xss.map((xs) => xs.length))).toBeLessThanOrEqual(8);
    expect(Math.max(...ss.map((s) => s.length))).toBeLessThanOrEqual(13); // boundary 'hello world' etc; random <= 12
    const small = flat.filter((v) => Math.abs(v) <= 20).length;
    expect(small / flat.length).toBeGreaterThan(0.5);
  });
  it('offers surrogate strings only as excluded cases, all rejected by the bmp precondition', () => {
    const g = generateInputs(t, { n: 300, seed: 3 });
    expect(g.excludedOffered).toBe(SURROGATE_CASES.length);
    expect(g.excludedAccepted).toEqual([]);
    expect(g.rejected.bmp).toBeGreaterThanOrEqual(SURROGATE_CASES.length);
    for (const x of g.inputs) expect(/[\ud800-\udfff]/.test(x[0] as string)).toBe(false);
  });
  it('biases toward ASCII when an ascii precondition applies', () => {
    const ts = tr(SHOUT, 'shout');
    expect(ts.preconditions.some((p) => p.kind === 'ascii')).toBe(true);
    const g = generateInputs(ts, { n: 300, seed: 5 });
    const nonAscii = g.inputs.filter((x) => /[^\x00-\x7f]/.test(x[0] as string)).length;
    expect(nonAscii).toBeGreaterThan(0); // excluded cases still exercised (range-violation in the runner)
    expect(nonAscii / g.inputs.length).toBeLessThan(0.25);
  });
  it('rejection-samples on ts preconditions', () => {
    const preds = compilePreconditions(t.params, t.preconditions);
    expect(preds.map((p) => p.id)).toEqual(expect.arrayContaining(['int-bound', 'bmp']));
    const ib = preds.find((p) => p.id === 'int-bound')!;
    expect(ib.test(['a', [1.5], true])).toBe(false);
    expect(ib.test(['a', [2 ** 53 + 2], true])).toBe(false);
    expect(ib.test(['a', [2 ** 53], true])).toBe(true);
  });
});

describe('Outcome comparison (pure)', () => {
  it('is exact; fault is never agreement; record keys are order-independent', () => {
    expect(valEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(valEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valEqual(null, 0)).toBe(false);
    expect(outcomeEqual({ tag: 'ok', value: 1 }, { tag: 'ok', value: 1 })).toBe(true);
    expect(outcomeEqual({ tag: 'ok', value: 1 }, { tag: 'throw', message: '1' })).toBe(false);
    expect(outcomeEqual({ tag: 'fault', detail: 'x' }, { tag: 'fault', detail: 'x' })).toBe(false);
  });
});

describe('corpus header parser (pure)', () => {
  it('parses the grammar and rejects malformed headers', () => {
    const h = parseCorpusHeader('// @corpus class=refuse expect=refuse code=float\n// @corpus throws\n// @corpus note=a b=c\nx');
    expect(h).toEqual({ cls: 'refuse', expect: 'refuse', code: 'float', notes: ['a b=c'], throws: true });
    expect(() => parseCorpusHeader('// @corpus class=x expect=refuse')).toThrow(/code/);
    expect(() => parseCorpusHeader('// @corpus class=x expect=ok code=float')).toThrow();
    expect(() => parseCorpusHeader('// @corpus class=x expect=maybe')).toThrow();
    expect(() => parseCorpusHeader('// @corpus bogus')).toThrow(/malformed/);
    expect(() => parseCorpusHeader('// nothing')).toThrow(/no/);
  });
});

describe('instrumented original in the sandbox (seam with translate/instrument.ts)', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open({ defaultTimeoutMs: 1000 });
  });
  afterAll(async () => {
    await sb.close();
  });
  it('rewrites exactly the two runtime spots', () => {
    const rt = sandboxRuntime();
    expect(rt).toContain('class RangeViolation extends FaithfulRangeViolation');
    expect(rt).toContain('return new Error(message)');
    expect(rt).not.toContain('new UserThrow(message)');
  });
  it('yields all four outcome tags with the runtime details', async () => {
    const f = tr(FACT, 'fact');
    expect((await sb.load('fact', instrumentedSandboxSource(f), INSTRUMENTED_ENTRY, { instrumented: true })).ok).toBe(true);
    const r = await sb.callBatch('fact', [[5], [-1], [18], [19], [30]]);
    const o = r.results.map((x) => x.outcome);
    expect(o[0]).toEqual({ tag: 'ok', value: 120 });
    expect(o[1]).toEqual({ tag: 'throw', message: 'negative' });
    expect(o[2]).toEqual({ tag: 'ok', value: 6402373705728000 });
    expect(o[3]!.tag).toBe('range-violation');
    expect((o[3] as { detail: string }).detail).toMatch(/^range check failed at line 1: p \* i/);
    expect(o[4]!.tag).toBe('range-violation');

    const s = tr(SHOUT, 'shout');
    await sb.load('shout', instrumentedSandboxSource(s), INSTRUMENTED_ENTRY, { instrumented: true });
    const so = (await sb.callBatch('shout', [['abc'], ['É'], ['ß']])).results.map((x) => x.outcome);
    expect(so[0]).toEqual({ tag: 'ok', value: 'ABC' });
    expect(so[1]!.tag).toBe('range-violation');
    expect((so[1] as { detail: string }).detail).toMatch(/^ascii check failed/);
    expect(so[2]!.tag).toBe('range-violation');

    const l = tr(LOOP, 'spin');
    await sb.load('spin', instrumentedSandboxSource(l), INSTRUMENTED_ENTRY, { instrumented: true });
    const lo = (await sb.callBatch('spin', [[3], [2 ** 53]], { perCallMs: 300 })).results.map((x) => x.outcome);
    expect(lo[0]).toEqual({ tag: 'ok', value: 3 });
    expect(lo[1]).toEqual({ tag: 'fault', detail: 'timeout' });
  });
  it('user names cannot capture the runtime: functions named FaithfulRangeViolation, Math, BigInt, Error (red-team round 3)', async () => {
    for (const name of ['FaithfulRangeViolation', 'Math', 'BigInt', 'Error', INSTRUMENTED_ENTRY]) {
      const t = tr(`export function ${name}(a: number): number { if (a < 0) throw "neg"; return a * a; }`, name);
      expect((await sb.load(`hyg:${name}`, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true })).ok, name).toBe(true);
      const o = (await sb.callBatch(`hyg:${name}`, [[3], [134217728], [-1]])).results.map((x) => x.outcome);
      expect(o[0], name).toEqual({ tag: 'ok', value: 9 });
      expect(o[1]!.tag, `${name}: ${JSON.stringify(o[1])}`).toBe('range-violation');
      expect(o[2], name).toEqual({ tag: 'throw', message: 'neg' });
    }
  });
  it('the int-bound ts predicate reads no global: parameters named Math, Number, globalThis (red-team round 3)', () => {
    const t = tr('export function f(Math: number, Number: number[], globalThis: [number, string]): number { return Math + Number.length + globalThis[0]; }', 'f');
    const preds = compilePreconditions(t.params, t.preconditions);
    const ok = (a: Val[]): boolean => preds.every((p) => p.test(a));
    expect(ok([3, [1, 2], [4, 'x']])).toBe(true);
    expect(ok([2 ** 53, [-(2 ** 53)], [0, '']])).toBe(true);
    expect(ok([2 ** 53 + 2, [1], [0, '']])).toBe(false);
    expect(ok([1.5, [1], [0, '']])).toBe(false);
    expect(ok([1, [0.5], [0, '']])).toBe(false);
    expect(ok([1, [1], [Infinity, '']])).toBe(false);
  });
  it('tsVsTs: agreement, disagreement, exclusion, load errors', async () => {
    const f = tr(FACT, 'fact');
    const good = { fnName: 'fact', source: `export function fact(n: number): number { if (n < 0) throw new Error("negative"); return n <= 1 ? 1 : n * fact(n - 1); }` };
    const bad = { fnName: 'fact', source: `export function fact(n: number): number { if (n < 0) throw new Error("neg"); return n <= 1 ? 1 : n * fact(n - 1); }` };
    const broken = { fnName: 'fact', source: `export function fact(n: number): number { return Date.now(); }` };
    const inputs: Val[][] = [[0], [1], [5], [-2], [25]];
    const r = await tsVsTs(f, [good, bad, broken], inputs, { sandbox: sb });
    expect(r.rangeExcluded).toBe(1);
    expect(r.candidates[0]!.agreements).toBe(4);
    expect(r.candidates[0]!.disagreements).toEqual([]);
    expect(r.candidates[1]!.disagreements.map((d) => d.args)).toEqual([[-2]]);
    expect(r.candidates[2]!.agreements).toBe(0); // impure: fault on every input
  });
});

describe.skipIf(!hasLean)('tsVsLean (real Lean)', () => {
  it('agrees on a small function, with range-excluded inputs checked against rangeOk', async () => {
    const f = tr(FACT, 'fact');
    const lean = await leanEvaluator();
    const r = await tsVsLean(f, { n: 120, seed: 11, perCallMs: 300 }, { lean });
    expect(r.disagreements).toEqual([]);
    expect(r.underPreconditions).toBe(120);
    expect(r.rangeExcluded).toBeGreaterThan(0);
    expect(r.rangeOkAgreements).toBe(r.rangeExcluded);
    expect(r.agreementTags.throw).toBeGreaterThan(0);
    expect(r.agreements + r.rangeExcluded + r.tsFaults + r.tooCostly).toBe(r.underPreconditions);
  }, 300_000);
  it('detects a wrong model: another function\'s Lean model with the same signature disagrees on exactly one input', async () => {
    const f = tr(FACT, 'fact');
    const lean = await leanEvaluator();
    const other = tr(`export function fact(n: number): number { if (n < 0) throw new Error("negative"); let p = 1; for (let i = 2; i <= n; i++) { p = p * i; } return p + (n === 4 ? 1 : 0); }`, 'fact');
    const wrong: Translation = { ...f, lean: other.lean };
    const r = await tsVsLean(wrong, { n: 0, seed: 1, inputs: [[3], [4], [5], [-1]], perCallMs: 300 }, { lean });
    expect(r.disagreements.map((d) => [d.kind, d.args])).toEqual([['outcome', [4]]]);
  }, 300_000);
});
