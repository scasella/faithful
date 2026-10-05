import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox } from '../sandbox/sandbox.js';
import { compileGate } from './compile.js';
import { purityGate } from './purity.js';

const ORIGINAL = `
interface Point { x: number; y: number }
export function dist(p: Point, q: Point): number {
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
}`;

describe('compileGate', () => {
  it('passes a candidate with the same signature, structurally (alias vs inline record)', () => {
    const cand = `export function dist(a: { y: number; x: number }, b: { x: number; y: number }): number {
      const dx = a.x - b.x; const dy = a.y - b.y; return (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
    }`;
    const r = compileGate({ candidate: cand, original: ORIGINAL, fnName: 'dist' });
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.signature).toEqual({
      params: [
        { name: 'a', type: '{ x: number; y: number }', optional: false },
        { name: 'b', type: '{ x: number; y: number }', optional: false },
      ],
      ret: 'number',
    });
    expect(r.originalSignature!.params.map((p) => p.type)).toEqual(r.signature!.params.map((p) => p.type));
  });

  it('reports type errors with line, column and message', () => {
    const cand = `export function dist(p: { x: number; y: number }, q: { x: number; y: number }): number {
  const s: string = p.x;
  return s.length;
}`;
    const r = compileGate({ candidate: cand, original: ORIGINAL, fnName: 'dist' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([
      { file: 'candidate', line: 2, column: 9, message: "Type 'number' is not assignable to type 'string'.", code: 2322, category: 'error' },
    ]);
  });

  it('is strict: implicit any, and undeclared Node / DOM globals fail', () => {
    const r = compileGate({ candidate: 'export function f(x) { return x; }', fnName: 'f' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ code: 7006, line: 1, column: 19 });
    const g = compileGate({ candidate: 'export function f(): number { console.log(1); return process.pid + fetch.length; }', fnName: 'f' });
    expect(g.ok).toBe(false);
    expect(g.diagnostics.map((d) => d.code).sort()).toEqual([2304, 2584, 2591]);
  });

  it('rejects a signature change: parameter type, arity, return type, option-ness', () => {
    const orig = 'export function f(xs: number[], k: number): number | null { return xs[k] ?? null; }';
    const wrongParam = compileGate({ original: orig, fnName: 'f', candidate: 'export function f(xs: string[], k: number): number | null { return xs.length > k ? k : null; }' });
    expect(wrongParam.ok).toBe(false);
    expect(wrongParam.diagnostics).toEqual([
      expect.objectContaining({ code: 0, line: 1, column: 19, message: "parameter 1 ('xs') has type string[]; the original's has number[]" }),
    ]);
    const arity = compileGate({ original: orig, fnName: 'f', candidate: 'export function f(xs: number[]): number | null { return xs[0] ?? null; }' });
    expect(arity.ok).toBe(false);
    expect(arity.diagnostics[0]!.message).toMatch(/takes 1 parameter\(s\); the original takes 2/);
    const ret = compileGate({ original: orig, fnName: 'f', candidate: 'export function f(xs: number[], k: number): number { return xs[k] ?? 0; }' });
    expect(ret.ok).toBe(false);
    expect(ret.diagnostics[0]!.message).toBe("'f' returns number; the original returns null | number");
    const same = compileGate({ original: orig, fnName: 'f', candidate: 'export function f(a: Array<number>, i: number): null | number { return i < a.length ? a[i]! : null; }' });
    expect(same.diagnostics).toEqual([]);
    expect(same.ok).toBe(true);
  });

  it('compares tuples, nested records and booleans structurally', () => {
    const orig = `type R = { name: string; tags: string[]; at: [number, boolean] };
      export function g(r: R): R[] { return [r]; }`;
    const okCand = `export function g(r: { at: [number, boolean]; tags: Array<string>; name: string }): { name: string; tags: string[]; at: [number, boolean] }[] { return [r, r]; }`;
    expect(compileGate({ original: orig, candidate: okCand, fnName: 'g' }).ok).toBe(true);
    const badCand = `export function g(r: { at: [boolean, number]; tags: string[]; name: string }): { name: string; tags: string[]; at: [boolean, number] }[] { return [r]; }`;
    const bad = compileGate({ original: orig, candidate: badCand, fnName: 'g' });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]!.message).toContain('at: [boolean, number]');
  });

  it('requires the exported function and refuses imports', () => {
    const missing = compileGate({ candidate: 'function f(): number { return 1; }', fnName: 'f' });
    expect(missing.ok).toBe(false);
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 0, message: "the candidate does not export a function named 'f'" }));
    const listed = compileGate({ candidate: 'function f(): number { return 1; }\nexport { f };', fnName: 'f' });
    expect(listed.ok).toBe(true);
    const imp = compileGate({ candidate: 'import { x } from "./x";\nexport function f(): number { return x; }', fnName: 'f' });
    expect(imp.ok).toBe(false);
    expect(imp.diagnostics).toContainEqual(expect.objectContaining({ code: 0, line: 1, column: 1 }));
  });

  it('reports errors in the original separately', () => {
    const r = compileGate({ original: 'export function f(x: number): number { return x.foo; }', candidate: 'export function f(x: number): number { return x; }', fnName: 'f' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.every((d) => d.file === 'original')).toBe(true);
  });

  it('is fast once warm', () => {
    compileGate({ candidate: 'export function w(): number { return 1; }', fnName: 'w' });
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) compileGate({ candidate: `export function w(): number { return ${i}; }`, original: ORIGINAL, fnName: 'w' });
    const per = (performance.now() - t0) / 5;
    console.log(`[compile gate] ${per.toFixed(1)} ms per warm compile`);
    expect(per).toBeLessThan(2000);
  });
});

describe('purityGate', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });

  it('passes a pure function', async () => {
    const r = await purityGate(sb, { id: 'd', source: ORIGINAL, fnName: 'dist', sample: [[{ x: 0, y: 0 }, { x: 3, y: -4 }]] });
    expect(r).toMatchObject({ gate: 'purity', ok: true, violations: [], sampleSize: 1 });
    expect(r.report!.outcomes).toEqual([{ tag: 'ok', value: 7 }]);
  });

  it('fails on a clock read, on hidden state, and (by default) on input mutation', async () => {
    const clock = await purityGate(sb, { id: 'c', source: 'export function f(n: number): number { return n + Date.now() % 2; }', fnName: 'f', sample: [[1]] });
    expect(clock.ok).toBe(false);
    expect(clock.violations).toEqual([{ kind: 'ambient', what: 'Date.now' }]);
    const state = await purityGate(sb, { id: 's', source: 'let k = 0;\nexport function f(n: number): number { return n + (k++ % 2); }', fnName: 'f', sample: [[1]] });
    expect(state.ok).toBe(false);
    expect(state.violations[0]!.kind).toBe('nondeterminism');
    const mut = { id: 'm', source: 'export function f(xs: number[]): number { xs.sort((a, b) => a - b); return xs[0]!; }', fnName: 'f', sample: [[[2, 1]]] };
    expect((await purityGate(sb, mut)).ok).toBe(false);
    const tolerated = await purityGate(sb, { ...mut, failOnInputMutation: false });
    expect(tolerated.ok).toBe(true);
    expect(tolerated.violations).toEqual([{ kind: 'input-mutation', what: 'argument 0 at $[0]' }]);
  });

  it('reports a load failure', async () => {
    const r = await purityGate(sb, { id: 'x', source: 'export function g(): number { return 1; }', fnName: 'f', sample: [[]] });
    expect(r.ok).toBe(false);
    expect(r.loadError).toMatch(/not defined/);
  });
});
