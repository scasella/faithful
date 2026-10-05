import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox } from './sandbox.js';

/** One function per test: `f(): number` with the given body; returns the call result. */
describe('Sandbox: purity traps (inside the worker)', () => {
  let sb: Sandbox;
  let n = 0;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });
  const run = async (body: string, args: unknown[] = [], params = '') => {
    const id = `p${n++}`;
    const l = await sb.load(id, `export function f(${params}): any { ${body} }`, 'f');
    if (!l.ok) throw new Error(`load failed: ${l.error}`);
    return sb.call(id, args as never);
  };

  it.each([
    ['return Math.random();', 'Math.random'],
    ['return Date.now();', 'Date.now'],
    ['return new Date().getTime();', 'Date (reads the clock)'],
    ['return String(Date());', 'Date (reads the clock)'],
    ['return fetch("http://example.com");', 'fetch'],
    ['process.exit(1); return 0;', 'process'],
    ['return require("fs");', 'require'],
    ['console.log("hi"); return 0;', 'console'],
    ['return performance.now();', 'performance'],
    ['setTimeout(() => 0, 0); return 0;', 'setTimeout'],
    ['return crypto.getRandomValues(new Uint8Array(1))[0];', 'crypto'],
    ['return globalThis.process.pid;', 'globalThis'],
    ['return global.process.pid;', 'global'],
    ['return new Function("return 1")();', 'Function'],
    ['return Buffer.from("x").length;', 'Buffer'],
  ])('%s -> fault and ambient violation %s', async (body, what) => {
    const r = await run(body);
    expect(r.outcome).toEqual({ tag: 'fault', detail: `impure: ${what}` });
    expect(r.violations).toEqual([{ kind: 'ambient', what }]);
  });

  it('records a trap even when the candidate swallows it', async () => {
    const r = await run('try { return Math.random(); } catch { return 0; }');
    expect(r.outcome).toEqual({ tag: 'fault', detail: 'impure: Math.random' });
    expect(r.violations).toEqual([{ kind: 'ambient', what: 'Math.random' }]);
  });

  it.each([
    // The escapes the reference documents: reach the real global object through a function constructor or eval.
    ['return (() => 0).constructor("return this")().process.pid;', 'Function constructor'],
    ['return (function () {}).constructor("return process")().pid;', 'Function constructor'],
    ['return (async () => 0).constructor("return 1");', 'AsyncFunction constructor'],
    ['return (function* () {}).constructor("yield 1");', 'GeneratorFunction constructor'],
    ['return (async function* () {}).constructor("yield 1");', 'AsyncGeneratorFunction constructor'],
    ['return Object.getPrototypeOf(() => 0).constructor("return this")();', 'Function constructor'],
    ['return (0, eval)("this").process.pid;', 'eval'],
    ['return eval("1 + 1");', 'eval'],
  ])('escape attempt %s is trapped (%s)', async (body, what) => {
    const r = await run(body);
    expect(r.outcome.tag).toBe('fault');
    expect(r.violations).toContainEqual({ kind: 'ambient', what });
  });

  it('a write to the real global object through an escape is caught and undone', async () => {
    // With every constructor trapped, the escape itself is the violation; the global stays clean.
    const r = await run('try { (() => 0).constructor("return this")().__leaked = 1; } catch {} return 1;');
    expect(r.outcome.tag).toBe('fault');
    expect(r.violations).toContainEqual({ kind: 'ambient', what: 'Function constructor' });
    expect((await run('return typeof __leaked;')).outcome).toEqual({ tag: 'ok', value: 'undefined' });
  });

  it('detects and restores modified intrinsics across calls', async () => {
    const r = await run('Object.is = () => true; Array.prototype.extra = 1; Math.floor = () => 7; return 0;');
    expect(r.outcome.tag).toBe('fault');
    expect(r.violations).toEqual(
      expect.arrayContaining([
        { kind: 'intrinsic', what: 'modified Object.is' },
        { kind: 'intrinsic', what: 'added property extra to Array.prototype' },
        { kind: 'intrinsic', what: 'modified Math.floor' },
      ]),
    );
    expect((await run('return [Object.is(1, 2), "extra" in [], Math.floor(2.5)];')).outcome).toEqual({
      tag: 'ok',
      value: [false, false, 2],
    });
  });

  it('keeps pure Math and integer arithmetic working', async () => {
    expect((await run('return Math.max(1, Math.abs(-5), Math.floor(7 / 2), Math.ceil(7 / 2), -7 % 3);')).outcome).toEqual({
      tag: 'ok',
      value: 5,
    });
  });

  it('reports input mutation as a structured violation without changing the outcome', async () => {
    const r = await run('xs.sort((a, b) => a - b); return xs[0];', [[3, 1, 2]], 'xs: number[]');
    expect(r.outcome).toEqual({ tag: 'ok', value: 1 });
    expect(r.violations).toEqual([{ kind: 'input-mutation', what: 'argument 0 at $[0]' }]);
    const rec = await run('p.x = 5; return p.x;', [{ x: 1 }], 'p: { x: number }');
    expect(rec.violations).toEqual([{ kind: 'input-mutation', what: 'argument 0 at $.x' }]);
  });

  it('gives every call fresh argument clones', async () => {
    await sb.load('push', 'export function f(xs: number[]): number { xs.push(1); return xs.length; }', 'f');
    const b = await sb.callBatch('push', [[[]], [[]]]);
    expect(b.results.map((r) => r.outcome)).toEqual([
      { tag: 'ok', value: 1 },
      { tag: 'ok', value: 1 },
    ]);
  });
});

describe('Sandbox.checkPurity', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });

  it('finds module-level state as nondeterminism', async () => {
    await sb.load('ctr', 'let calls = 0;\nexport function f(n: number): number { calls++; return n + calls; }', 'f');
    const rep = await sb.checkPurity('ctr', [[1], [2]]);
    expect(rep.pure).toBe(false);
    expect(rep.nondeterministic.map((x) => x.index)).toEqual([0, 1]);
    expect(rep.nondeterministic[0]).toEqual({ index: 0, first: { tag: 'ok', value: 2 }, second: { tag: 'ok', value: 3 } });
    expect(rep.violations[0]!.kind).toBe('nondeterminism');
  });

  it('passes a pure function and reports its outcomes', async () => {
    await sb.load('sq', 'export function f(n: number): number { if (n < 0) throw new Error("neg"); return n * n; }', 'f');
    const rep = await sb.checkPurity('sq', [[2], [-1]]);
    expect(rep).toEqual({
      pure: true,
      violations: [],
      nondeterministic: [],
      mutatedInputs: [],
      outcomes: [
        { tag: 'ok', value: 4 },
        { tag: 'throw', message: 'neg' },
      ],
    });
  });

  it('collects mutation and ambient violations', async () => {
    await sb.load('mut', 'export function f(xs: number[]): number { xs.reverse(); return xs.length; }', 'f');
    const rep = await sb.checkPurity('mut', [[[1, 2]], [[5]]]);
    expect(rep.pure).toBe(false);
    expect(rep.mutatedInputs).toEqual([0]);
    expect(rep.violations).toEqual([{ kind: 'input-mutation', what: 'argument 0 at $[0]' }]);
    await sb.load('rnd', 'export function f(): number { return Math.floor(Math.random() * 10); }', 'f');
    const r2 = await sb.checkPurity('rnd', [[]]);
    expect(r2.violations).toEqual([{ kind: 'ambient', what: 'Math.random' }]);
  });
});
