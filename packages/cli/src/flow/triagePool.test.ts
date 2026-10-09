/**
 * The triage worker pool: real worker threads (run from source through the resolve hook, so the code under test is the
 * code in the tree), the real translator, a real sandbox in each worker. A fixture worker stalls or dies on cue to check
 * that the pool survives. No model, no Lean, nothing written anywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox } from '@faithful/engine';
import { TriageTimeout, classifyFunction, classifyText, clearTriageCache, getOwn, unknownCause, type ClassifyItem } from './triage.js';
import { createTriagePool, type TriagePool } from './triagePool.js';

const GCD = `export function gcd(a: number, b: number): number {\n  if (a < b) {\n    return b - a;\n  }\n  return a - b;\n}\n`;
const HALF = `export function half(x: number): number {\n  return x / 2;\n}\n`;
const fn = (name: string): string => HALF.replace('half', name);

let pool: TriagePool;
let sandbox: Sandbox;
beforeAll(async () => {
  pool = createTriagePool({ size: 2 });
  sandbox = await Sandbox.open();
});
afterAll(async () => {
  await pool?.close();
  await sandbox?.close();
});

describe('worker pool', () => {
  it('runs in worker threads and answers what the in-thread classification answers', async () => {
    expect(pool.mode).toBe('workers');
    const text = GCD + HALF + `export function uses(x: number): number {\n  return x / k;\n}\n`; // `k` is nowhere: cannot run
    const q = await pool.quick(text);
    expect(q.fns.map((f) => f.name)).toEqual(['gcd', 'half', 'uses']);
    expect(q.verdicts).toMatchObject({ gcd: 'provable', half: 'float' });
    const items: ClassifyItem[] = [
      { name: 'half', refusal: 'float' },
      { name: 'uses', refusal: q.verdicts.uses === 'provable' ? null : q.verdicts.uses },
    ];
    const got = await pool.classify(text, items);
    for (const it of items) expect(got[it.name], it.name).toEqual(await classifyFunction(text, it.name, { sandbox }));
    expect(pool.stats().spawned).toBeGreaterThanOrEqual(1);
  });

  it('classifyText through a pool is the same as in this thread, and cached by content', async () => {
    clearTriageCache();
    const viaPool = await classifyText(GCD + HALF, { backend: pool });
    clearTriageCache();
    const inThread = await classifyText(GCD + HALF, { sandbox });
    expect(viaPool).toEqual(inThread);
    expect(viaPool).toEqual({ gcd: { tier: 'provable', reason: null }, half: { tier: 'tested', reason: null } });
  });

  it('a request the user waits for (high) goes before queued background work (low)', async () => {
    const one = createTriagePool({ size: 1 });
    try {
      const order: string[] = [];
      // the first request occupies the worker; the rest queue
      const first = one.quick(GCD, { priority: 'low' }).then(() => order.push('first'));
      const low = one.quick(HALF, { priority: 'low' }).then(() => order.push('low'));
      const high = one.quick(fn('h'), { priority: 'high' }).then(() => order.push('high'));
      await Promise.all([first, low, high]);
      expect(order).toEqual(['first', 'high', 'low']);
    } finally {
      await one.close();
    }
  });

  it('keeps the main thread responsive while a worker is busy (timers keep firing)', async () => {
    // a file with many functions: translating them all takes the worker a while
    let big = '';
    for (let i = 0; i < 150; i++) big += `export function g${i}(a: number, b: number): number {\n  if (a < b) {\n    return b - a + ${i};\n  }\n  return a - b;\n}\n`;
    let max = 0;
    let last = performance.now();
    const probe = setInterval(() => {
      const now = performance.now();
      max = Math.max(max, now - last - 5);
      last = now;
    }, 5);
    const t0 = performance.now();
    const q = await pool.quick(big);
    const took = performance.now() - t0;
    clearInterval(probe);
    expect(q.fns).toHaveLength(150);
    // the work took the worker far longer than the main thread was ever blocked for
    expect(max).toBeLessThan(Math.max(100, took / 3));
  });

  it('a worker that stops answering is killed; what it decided is kept, the function in progress is over the cap, the rest is asked again', async () => {
    const stalling = createTriagePool({ size: 1, capMs: 2000, stallMs: 300, entry: new URL('./triageWorker.fixture.ts', import.meta.url) });
    try {
      const text = fn('a') + fn('stall') + fn('b') + fn('c');
      const items: ClassifyItem[] = ['a', 'stall', 'b', 'c'].map((name) => ({ name, refusal: 'float' as const }));
      const got = await stalling.classify(text, items);
      expect(got.a).toEqual({ tier: 'tested', reason: null });
      expect(got.stall).toEqual({ tier: 'unknown', reason: 'Checking took longer than 2 seconds; not run.' });
      expect(unknownCause(got.stall!)).toBe('slow');
      expect(got.b).toEqual({ tier: 'tested', reason: null });
      expect(got.c).toEqual({ tier: 'tested', reason: null });
      const st = stalling.stats();
      expect(st.killed).toBe(1);
      expect(st.spawned).toBe(2);
      // and the pool still works afterwards
      expect(await stalling.classify(fn('d'), [{ name: 'd', refusal: 'float' }])).toEqual({ d: { tier: 'tested', reason: null } });
    } finally {
      await stalling.close();
    }
  });

  it('a quick request that keeps signing of life is not a stall; one that stays silent is killed and says it ran out of time (TriageTimeout), not that it failed', async () => {
    const p = createTriagePool({ size: 1, quickMs: 600, entry: new URL('./triageWorker.fixture.ts', import.meta.url) });
    try {
      // warm the worker first: its cold start (a worker thread loading TypeScript source) counts against the 600 ms
      // silence budget and, on a busy or slow machine, can come close to it; what is tested is the stall rule
      expect((await p.quick(HALF)).fns).toHaveLength(1);
      // 1400 ms of work, a sign every 200 ms: longer than the 600 ms silence budget, still alive (the beat interval is a third of the budget, so a timer that runs late on a slow machine does not look like a stall)
      const q = await p.quick(GCD + '// beats\n');
      expect(q.fns.map((f) => f.name)).toEqual(['gcd']);
      expect(p.stats().killed).toBe(0);
      await expect(p.quick(GCD + '// silent\n')).rejects.toBeInstanceOf(TriageTimeout);
      await expect(p.quick(GCD + '// silent\n')).rejects.toMatchObject({ ms: 600 });
      expect(p.stats().killed).toBe(2);
      // and the pool carries on
      expect((await p.quick(HALF)).fns).toHaveLength(1);
    } finally {
      await p.close();
    }
  });

  it('names that are inherited properties of an object survive the worker boundary as own entries', async () => {
    const odd = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
    const text = GCD + odd.map(fn).join('');
    const q = await pool.quick(text);
    for (const n of ['gcd', ...odd]) expect(getOwn(q.verdicts, n), n).toBeDefined();
    const got = await pool.classify(text, odd.map((name) => ({ name, refusal: 'float' as const })));
    for (const n of odd) expect(getOwn(got, n), n).toEqual({ tier: 'tested', reason: null });
    expect(Object.keys(got).sort()).toEqual([...odd].sort());
  });

  it('a worker that dies is replaced; the function it died on is "failed", the rest is decided', async () => {
    const dying = createTriagePool({ size: 1, capMs: 2000, entry: new URL('./triageWorker.fixture.ts', import.meta.url) });
    try {
      const text = fn('a') + fn('crash') + fn('b');
      const got = await dying.classify(text, ['a', 'crash', 'b'].map((name) => ({ name, refusal: 'float' as const })));
      expect(got.a).toEqual({ tier: 'tested', reason: null });
      expect(got.crash).toMatchObject({ tier: 'unknown' });
      expect(unknownCause(got.crash!)).toBe('failed');
      expect(got.b).toEqual({ tier: 'tested', reason: null });
      expect(dying.stats().crashed).toBe(1);
    } finally {
      await dying.close();
    }
  });

  it('the stall watchdog works for a request that never starts a function too (a stalled worker is replaced)', async () => {
    const p = createTriagePool({ size: 1 }) as TriagePool & { _spin(ms: number): Promise<'finished' | 'killed'> };
    try {
      expect(await p._spin(2000)).toBe('killed');
      expect(p.stats().killed).toBe(1);
      expect((await p.quick(GCD)).fns).toHaveLength(1);
    } finally {
      await p.close();
    }
  });

  it('workers idle for a while are ended and started again on the next request', async () => {
    const p = createTriagePool({ size: 1, idleMs: 150 });
    try {
      await p.quick(GCD);
      expect(p.stats().spawned).toBe(1);
      for (let i = 0; i < 100 && p.stats().retired === 0; i++) await new Promise((r) => setTimeout(r, 25));
      expect(p.stats().retired).toBe(1);
      expect((await p.quick(HALF)).verdicts).toMatchObject({ half: 'float' });
      expect(p.stats().spawned).toBe(2);
    } finally {
      await p.close();
    }
  });

  it('close ends the workers; a request after close does not hang', async () => {
    const p = createTriagePool({ size: 1 });
    await p.quick(GCD);
    await p.close();
    await expect(p.quick(GCD)).rejects.toThrow();
    expect(await p.classify(HALF, [{ name: 'half', refusal: 'float' }])).toMatchObject({ half: { tier: 'unknown' } });
  });

  it('when workers cannot be started, the pool says so once and runs on this thread', async () => {
    const written: string[] = [];
    const real = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => (written.push(String(chunk)), true)) as typeof process.stderr.write;
    const broken = createTriagePool({ size: 1, entry: new URL('./no-such-worker.ts', import.meta.url) });
    try {
      expect(broken.mode).toBe('workers');
      expect(await broken.classify(HALF, [{ name: 'half', refusal: 'float' }])).toEqual({ half: { tier: 'tested', reason: null } });
      expect(broken.mode).toBe('inline');
      expect((await broken.quick(GCD)).verdicts).toMatchObject({ gcd: 'provable' });
      expect(written.filter((w) => w.includes('worker threads could not be started'))).toHaveLength(1);
    } finally {
      process.stderr.write = real;
      await broken.close();
    }
  });

  it('inline mode runs on this thread with the same answers', async () => {
    const inline = createTriagePool({ inline: true });
    try {
      expect(inline.mode).toBe('inline');
      const q = await inline.quick(GCD + HALF);
      expect(q.verdicts).toMatchObject({ gcd: 'provable', half: 'float' });
      expect(await inline.classify(HALF, [{ name: 'half', refusal: 'float' }])).toEqual({ half: { tier: 'tested', reason: null } });
    } finally {
      await inline.close();
    }
  });
});
