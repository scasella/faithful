import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, liveSandboxWorkers } from './sandbox.js';

const SUM = `export function sum(xs: number[]): number { let s = 0; for (const x of xs) s += x; return s; }`;

describe('Sandbox: outcomes', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open();
  });
  afterAll(async () => {
    await sb.close();
  });

  it('runs a typed function and returns ok with a JSON Val', async () => {
    expect(await sb.load('sum', SUM, 'sum')).toMatchObject({ ok: true });
    const r = await sb.call('sum', [[1, 2, 3]]);
    expect(r.outcome).toEqual({ tag: 'ok', value: 6 });
    expect(r.violations).toEqual([]);
  });

  it('supports interfaces, records, tuples, options and self-recursion', async () => {
    const src = `
      interface P { x: number; y: number }
      type Pair = [number, string];
      export function f(p: P, n: number): { s: number; t: Pair; o: number | null } {
        const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
        return { s: p.x + p.y, t: [fact(n), 'ok'], o: n > 3 ? n : null };
      }
      export function g(n: number): number { return n <= 0 ? 0 : 1 + g(n - 1); }`;
    expect((await sb.load('f', src, 'f')).ok).toBe(true);
    expect((await sb.call('f', [{ x: 1, y: 2 }, 5])).outcome).toEqual({ tag: 'ok', value: { s: 3, t: [120, 'ok'], o: 5 } });
    expect((await sb.call('f', [{ x: 1, y: 2 }, 2])).outcome).toEqual({ tag: 'ok', value: { s: 3, t: [2, 'ok'], o: null } });
    expect((await sb.load('g', src, 'g')).ok).toBe(true);
    expect((await sb.call('g', [1000])).outcome).toEqual({ tag: 'ok', value: 1000 });
  });

  it('maps undefined to null and -0 to 0; non-integers, NaN and out-of-range numbers are faults', async () => {
    const src = `export function h(k: number): number | undefined {
      if (k === 0) return undefined; if (k === 1) return -0; if (k === 2) return 5 / 2; if (k === 3) return 0 / 0;
      if (k === 4) return 2 ** 60; return 2 ** 53; }`;
    expect((await sb.load('h', src, 'h')).ok).toBe(true);
    expect((await sb.call('h', [0])).outcome).toEqual({ tag: 'ok', value: null });
    const z = (await sb.call('h', [1])).outcome;
    expect(z).toEqual({ tag: 'ok', value: 0 });
    expect(Object.is((z as { value: number }).value, -0)).toBe(false);
    expect((await sb.call('h', [2])).outcome).toEqual({ tag: 'fault', detail: 'result is not an integer (2.5) at $' });
    expect((await sb.call('h', [3])).outcome).toEqual({ tag: 'fault', detail: 'result is NaN at $' });
    expect((await sb.call('h', [4])).outcome.tag).toBe('fault');
    expect((await sb.call('h', [5])).outcome).toEqual({ tag: 'ok', value: 2 ** 53 });
  });

  it('maps a literal throw to {tag:"throw"} and everything else thrown to fault', async () => {
    const src = `export function t(k: number): number {
      if (k === 0) throw new Error("negative input");
      if (k === 1) throw "plain string";
      if (k === 2) { const o: any = undefined; return o.x; }
      if (k === 3) throw new TypeError("typed");
      if (k === 4) throw 42;
      return k; }`;
    expect((await sb.load('t', src, 't')).ok).toBe(true);
    expect((await sb.call('t', [0])).outcome).toEqual({ tag: 'throw', message: 'negative input' });
    expect((await sb.call('t', [1])).outcome).toEqual({ tag: 'throw', message: 'plain string' });
    const r2 = (await sb.call('t', [2])).outcome;
    expect(r2.tag).toBe('fault');
    expect((r2 as { detail: string }).detail).toMatch(/^uncaught TypeError: /);
    expect((await sb.call('t', [3])).outcome).toEqual({ tag: 'fault', detail: 'uncaught TypeError: typed' });
    expect((await sb.call('t', [4])).outcome).toEqual({ tag: 'fault', detail: 'threw a non-Error value (number)' });
    expect((await sb.call('t', [9])).outcome).toEqual({ tag: 'ok', value: 9 });
  });

  it('turns a stack overflow into fault "stack overflow" and keeps working', async () => {
    const src = `export function deep(n: number): number { return n === 0 ? 0 : 1 + deep(n - 1); }`;
    expect((await sb.load('deep', src, 'deep')).ok).toBe(true);
    expect((await sb.call('deep', [1e7])).outcome).toEqual({ tag: 'fault', detail: 'stack overflow' });
    expect((await sb.call('deep', [10])).outcome).toEqual({ tag: 'ok', value: 10 });
  });

  it('reports load problems as data: syntax errors, missing function, imports, impure top level', async () => {
    const syntax = await sb.load('bad1', 'export function f(: number { return 1 }', 'f');
    expect(syntax.ok).toBe(false);
    const missing = await sb.load('bad2', 'export function g(): number { return 1 }', 'f');
    expect(missing).toMatchObject({ ok: false });
    expect((missing as { error: string }).error).toMatch(/not defined/);
    const imp = await sb.load('bad3', 'import fs from "node:fs";\nexport function f(): number { return 1 }', 'f');
    expect((imp as { error: string }).error).toMatch(/line 1, column 1: import declarations are not allowed/);
    const dyn = await sb.load('bad4', 'export function f(): number { void import("node:fs"); return 1 }', 'f');
    expect((dyn as { error: string }).error).toMatch(/dynamic import\(\) is not allowed/);
    const top = await sb.load('bad5', 'const t0 = Date.now();\nexport function f(): number { return t0 }', 'f');
    expect(top).toMatchObject({ ok: false, violations: [{ kind: 'ambient', what: 'Date.now' }] });
    await expect(sb.call('bad5', [])).rejects.toThrow(/no function loaded/);
  });

  it('instrumented mode: FaithfulRangeViolation from the injected helpers becomes range-violation', async () => {
    const src = `
      declare function __faithfulInt(v: number, d: string): number;
      declare function __faithfulCheck(ok: boolean, d: string): void;
      export function mul(a: number, b: number): number {
        __faithfulCheck(b !== 0, 'divisor b is non-zero');
        return __faithfulInt(a * b, 'a * b') + Math.floor(a / b);
      }`;
    expect((await sb.load('mul', src, 'mul', { instrumented: true })).ok).toBe(true);
    expect((await sb.call('mul', [6, 3])).outcome).toEqual({ tag: 'ok', value: 20 });
    expect((await sb.call('mul', [2 ** 40, 2 ** 20])).outcome).toEqual({
      tag: 'range-violation',
      detail: `a * b is not an integer within +-2^53 (got ${2 ** 60})`,
    });
    expect((await sb.call('mul', [1, 0])).outcome).toEqual({ tag: 'range-violation', detail: 'divisor b is non-zero' });
    // A source-defined class of the same name is recognised too.
    const own = `class FaithfulRangeViolation extends Error { constructor(m: string) { super(m); this.name = 'FaithfulRangeViolation'; } }
      export function k(a: number): number { if (a > 10) throw new FaithfulRangeViolation('a too big'); return a; }`;
    expect((await sb.load('own', own, 'k', { instrumented: true })).ok).toBe(true);
    expect((await sb.call('own', [11])).outcome).toEqual({ tag: 'range-violation', detail: 'a too big' });
    // Without instrumented mode the helpers are not in scope and such an error is a fault.
    expect((await sb.load('own2', own, 'k')).ok).toBe(true);
    expect((await sb.call('own2', [11])).outcome).toEqual({ tag: 'fault', detail: 'uncaught FaithfulRangeViolation: a too big' });
    expect((await sb.load('mul2', src, 'mul')).ok).toBe(true);
    expect((await sb.call('mul2', [6, 3])).outcome.tag).toBe('fault');
  });
});

describe('Sandbox: watchdog', () => {
  it('kills a while(true) candidate, respawns, and replays loads', async () => {
    const sb = await Sandbox.open();
    try {
      expect((await sb.load('sum', SUM, 'sum')).ok).toBe(true);
      expect((await sb.load('spin', 'export function spin(n: number): number { while (true) { n++; } }', 'spin')).ok).toBe(true);
      const t0 = performance.now();
      const r = await sb.call('spin', [0], { timeoutMs: 200 });
      const ms = performance.now() - t0;
      expect(r.outcome).toEqual({ tag: 'fault', detail: 'timeout' });
      expect(ms).toBeLessThan(5000);
      expect(sb.spawned).toBe(2);
      // Both functions are back in the new worker.
      expect((await sb.call('sum', [[4, 5]])).outcome).toEqual({ tag: 'ok', value: 9 });
      expect((await sb.call('spin', [0], { timeoutMs: 100 })).outcome).toEqual({ tag: 'fault', detail: 'timeout' });
      expect(sb.spawned).toBe(3);
    } finally {
      await sb.close();
    }
  });

  it('a top-level infinite loop at load time is a load error, not a hang', async () => {
    const sb = await Sandbox.open({ loadTimeoutMs: 300 });
    try {
      const r = await sb.load('x', 'while (true) {}\nexport function f(): number { return 1 }', 'f');
      expect(r).toEqual({ ok: false, error: 'timeout while evaluating the source', violations: [] });
      expect((await sb.load('sum', SUM, 'sum')).ok).toBe(true);
      expect((await sb.call('sum', [[1]])).outcome).toEqual({ tag: 'ok', value: 1 });
    } finally {
      await sb.close();
    }
  });

  it('a batch with one hanging input times out only that input and finishes the rest', async () => {
    const sb = await Sandbox.open();
    try {
      const src = 'export function f(n: number): number { if (n === 7) { while (true) {} } return n * 2; }';
      expect((await sb.load('f', src, 'f')).ok).toBe(true);
      const args = Array.from({ length: 20 }, (_, i) => [i]);
      const b = await sb.callBatch('f', args, { perCallMs: 150, totalMs: 10_000 });
      expect(b.timedOut).toEqual([7]);
      expect(b.respawns).toBe(1);
      expect(b.notRun).toBe(0);
      b.results.forEach((r, i) => {
        if (i === 7) expect(r.outcome).toEqual({ tag: 'fault', detail: 'timeout' });
        else expect(r.outcome).toEqual({ tag: 'ok', value: i * 2 });
      });
    } finally {
      await sb.close();
    }
  });

  it('the batch budget stops a batch of slow calls; unrun inputs are reported, not invented', async () => {
    const sb = await Sandbox.open();
    try {
      const src = 'export function slow(n: number): number { let i = 0; while (i < 1e12) i++; return n; }';
      expect((await sb.load('slow', src, 'slow')).ok).toBe(true);
      const b = await sb.callBatch('slow', [[1], [2], [3]], { perCallMs: 5000, totalMs: 300 });
      expect(b.ms).toBeLessThan(5000);
      expect(b.timedOut).toEqual([0]);
      expect(b.results[0]!.outcome).toEqual({ tag: 'fault', detail: 'timeout' });
      expect(b.notRun).toBe(2);
      expect(b.results[2]!.outcome).toEqual({ tag: 'fault', detail: 'not run: batch budget exhausted' });
    } finally {
      await sb.close();
    }
  });

  it('a memory blowup is fault "out of memory" and the sandbox recovers', async () => {
    const sb = await Sandbox.open({ memoryMb: 64 });
    try {
      const src = `export function grow(n: number): number {
        const keep: number[][] = [];
        while (true) { const a: number[] = []; for (let i = 0; i < 100000; i++) a.push(i + n); keep.push(a); }
      }`;
      expect((await sb.load('grow', src, 'grow')).ok).toBe(true);
      expect((await sb.load('sum', SUM, 'sum')).ok).toBe(true);
      const r = await sb.call('grow', [1], { timeoutMs: 30_000 });
      expect(r.outcome).toEqual({ tag: 'fault', detail: 'out of memory' });
      expect((await sb.call('sum', [[2, 3]])).outcome).toEqual({ tag: 'ok', value: 5 });
      // In a batch too.
      const b = await sb.callBatch('grow', [[1], [2]], { perCallMs: 30_000, totalMs: 60_000 });
      expect(b.results.map((x) => x.outcome)).toEqual([
        { tag: 'fault', detail: 'out of memory' },
        { tag: 'fault', detail: 'out of memory' },
      ]);
    } finally {
      await sb.close();
    }
  });
});

describe('Sandbox: throughput', () => {
  it('measures calls per second for a trivial function', async () => {
    const sb = await Sandbox.open();
    try {
      expect((await sb.load('inc', 'export function inc(n: number): number { return n + 1; }', 'inc')).ok).toBe(true);
      const N = 20_000;
      const args = Array.from({ length: N }, (_, i) => [i]);
      await sb.callBatch('inc', args.slice(0, 1000)); // warm up
      const b = await sb.callBatch('inc', args, { perCallMs: 1000 });
      expect(b.results.every((r, i) => r.outcome.tag === 'ok' && r.outcome.value === i + 1)).toBe(true);
      const perSec = Math.round(N / (b.ms / 1000));
      const t0 = performance.now();
      for (let i = 0; i < 500; i++) await sb.call('inc', [i]);
      const singlePerSec = Math.round(500 / ((performance.now() - t0) / 1000));
      console.log(`[sandbox throughput] batch: ${N} calls in ${b.ms.toFixed(0)} ms = ${perSec} calls/s; single call(): ${singlePerSec} calls/s`);
      expect(perSec).toBeGreaterThan(1000);
    } finally {
      await sb.close();
    }
  });
});

describe('Sandbox: lifecycle', () => {
  it('leaves no worker thread behind after close (including respawned ones)', async () => {
    const before = liveSandboxWorkers();
    const sb = await Sandbox.open();
    expect(liveSandboxWorkers()).toBe(before + 1);
    await sb.load('spin', 'export function spin(): number { for (;;) {} }', 'spin');
    await sb.call('spin', [], { timeoutMs: 100 });
    expect(liveSandboxWorkers()).toBe(before + 1);
    await sb.close();
    expect(liveSandboxWorkers()).toBe(before);
    await expect(sb.call('spin', [])).rejects.toThrow(/closed/);
    await sb.close(); // idempotent
  });
});
