import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox } from '../sandbox/sandbox.js';
import { bench, compare, sweep, type Distribution } from './bench.js';
import { bootstrapLogLogSlope, bootstrapMedian, bootstrapRatio, median, MIN_RESAMPLES, verdict } from './stats.js';
import { mulberry32, randInt } from './rng.js';

const SUM = `export function total(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
}`;
/** Same result, five times the work. */
const SUM5 = `export function total(xs: number[]): number {
  let s = 0;
  for (let r = 0; r < 5; r++) {
    let t = 0;
    for (let i = 0; i < xs.length; i++) t += xs[i];
    s = t;
  }
  return s;
}`;
const SORT_IN_PLACE = `export function sorted(xs: number[]): number[] { xs.sort((a, b) => a - b); return xs; }`;
const QUAD = `export function pairs(xs: number[]): number {
  let c = 0;
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < xs.length; j++) if (xs[i] < xs[j]) c++;
  return c;
}`;

const arrays: Distribution = {
  name: 'uniform int arrays',
  sizes: [256, 2048],
  gen: (size, rng) => [Array.from({ length: size }, () => randInt(rng, -1000, 1000))],
};

const width = (i: { lo: number; hi: number; estimate: number }): number => (i.hi - i.lo) / i.estimate;

describe('stats (pure)', () => {
  it('median and a seeded, reproducible bootstrap interval that contains the median', () => {
    const rng = mulberry32(9);
    const xs = Array.from({ length: 41 }, () => 10 + rng());
    const a = bootstrapMedian(xs, { seed: 1 });
    const b = bootstrapMedian(xs, { seed: 1 });
    expect(a).toEqual(b);
    expect(a.estimate).toBe(median(xs));
    expect(a.lo).toBeLessThanOrEqual(a.estimate);
    expect(a.hi).toBeGreaterThanOrEqual(a.estimate);
  });

  it('refuses fewer than 2000 resamples', () => {
    expect(() => bootstrapMedian([1, 2, 3], { seed: 1, resamples: 500 })).toThrow(/2000/);
    expect(MIN_RESAMPLES).toBe(2000);
  });

  it('faster only on non-overlapping intervals', () => {
    expect(verdict({ estimate: 1, lo: 0.9, hi: 1.1 }, { estimate: 5, lo: 4.5, hi: 5.5 })).toBe('faster');
    expect(verdict({ estimate: 5, lo: 4.5, hi: 5.5 }, { estimate: 1, lo: 0.9, hi: 1.1 })).toBe('slower');
    // point estimates differ by 2x but the intervals touch: not distinguished
    expect(verdict({ estimate: 1, lo: 0.5, hi: 1.6 }, { estimate: 2, lo: 1.6, hi: 2.4 })).toBe('not-distinguished');
  });

  it('a flaky machine (identical true times) gives overlapping intervals, not a win; pervasive noise gives wide ones', () => {
    const rng = mulberry32(4);
    // Stalls: 40% of trials slowed 1x-6x, independently for both functions. The median is robust to < 50%
    // contamination, so the interval need not widen much; it must not produce a winner.
    const stalls = (): number => 10 * (rng() < 0.4 ? 1 + 5 * rng() : 1) * (1 + 0.02 * rng());
    // Pervasive load: every trial slowed by a factor in [1, 3].
    const loaded = (): number => 10 * (1 + 2 * rng());
    const quiet = (): number => 10 * (1 + 0.02 * rng());
    for (let rep = 0; rep < 20; rep++) {
      for (const noisy of [stalls, loaded]) {
        const ia = bootstrapMedian(Array.from({ length: 31 }, noisy), { seed: rep });
        const ib = bootstrapMedian(Array.from({ length: 31 }, noisy), { seed: rep + 100 });
        expect(verdict(ia, ib)).toBe('not-distinguished');
      }
      const il = bootstrapMedian(Array.from({ length: 31 }, loaded), { seed: rep });
      const q = bootstrapMedian(Array.from({ length: 31 }, quiet), { seed: rep });
      expect(width(il)).toBeGreaterThan(5 * width(q));
    }
  });

  it('ratio interval and log-log slope recover known values', () => {
    const rng = mulberry32(5);
    const a = Array.from({ length: 31 }, () => 1 + 0.05 * rng());
    const b = Array.from({ length: 31 }, () => 4 + 0.2 * rng());
    const r = bootstrapRatio(b, a, { seed: 2 });
    expect(r.lo).toBeGreaterThan(3.7);
    expect(r.hi).toBeLessThan(4.4);
    const pts = [64, 128, 256, 512, 1024].map((n) => ({ n, samples: Array.from({ length: 21 }, () => n * n * (1 + 0.05 * rng())) }));
    const s = bootstrapLogLogSlope(pts, { seed: 3 });
    expect(s.lo).toBeLessThan(2);
    expect(s.hi).toBeGreaterThan(2);
    expect(s.hi - s.lo).toBeLessThan(0.1);
  });
});

describe('benchmark in the sandbox', () => {
  let sb: Sandbox;
  beforeAll(async () => {
    sb = await Sandbox.open({ defaultTimeoutMs: 30_000 });
  });
  afterAll(async () => {
    await sb.close();
  });

  it('bench reports interval, trials, sizes, node version and date', async () => {
    const r = await bench(SUM, 'total', arrays, { sandbox: sb, seed: 1 });
    expect(r.trials).toBe(31);
    expect(r.sizes).toEqual([256, 2048]);
    expect(r.node).toBe(process.version);
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const s of r.perSize) {
      expect(s.perCallUs).toHaveLength(31);
      expect(s.perCall.lo).toBeLessThanOrEqual(s.perCall.estimate);
      expect(s.perCall.hi).toBeGreaterThanOrEqual(s.perCall.estimate);
      expect(Math.min(...s.trialMs)).toBeGreaterThan(5);
    }
    console.log(
      `bench total: ${r.perSize.map((s) => `n=${s.size} ${s.perCall.estimate.toFixed(3)} us [${s.perCall.lo.toFixed(3)}, ${s.perCall.hi.toFixed(3)}] (rel. width ${width(s.perCall).toFixed(3)}, reps ${s.reps})`).join('; ')}`,
    );
  });

  it('a function doing 5x the work is detected as slower with non-overlapping intervals', async () => {
    const r = await compare({ source: SUM5, fnName: 'total' }, { source: SUM, fnName: 'total' }, arrays, { sandbox: sb, seed: 2 });
    expect(r.overall.verdict).toBe('slower');
    for (const s of r.perSize) expect(s.verdict).toBe('slower');
    expect(r.candidate.pass.lo).toBeGreaterThan(r.incumbent.pass.hi);
    expect(r.overall.ratio.hi).toBeLessThan(1);
    console.log(
      `5x: speed-up ${r.overall.ratio.estimate.toFixed(3)} (95% CI ${r.overall.ratio.lo.toFixed(3)}-${r.overall.ratio.hi.toFixed(3)}); slowdown ${(1 / r.overall.ratio.estimate).toFixed(2)}x`,
    );
    // And the other way round: the 1x function is faster than the 5x one.
    const back = await compare({ source: SUM, fnName: 'total' }, { source: SUM5, fnName: 'total' }, arrays, { sandbox: sb, seed: 3 });
    expect(back.overall.verdict).toBe('faster');
    expect(back.overall.ratio.lo).toBeGreaterThan(1);
  }, 120_000);

  it('two identical functions: intervals overlap, no winner', async () => {
    const r = await compare({ source: SUM, fnName: 'total' }, { source: SUM, fnName: 'total' }, arrays, { sandbox: sb, seed: 4 });
    expect(r.overall.verdict).toBe('not-distinguished');
    expect(r.overall.ratio.lo).toBeLessThanOrEqual(1);
    expect(r.overall.ratio.hi).toBeGreaterThanOrEqual(1);
    console.log(
      `identical: ratio ${r.overall.ratio.estimate.toFixed(3)} (95% CI ${r.overall.ratio.lo.toFixed(3)}-${r.overall.ratio.hi.toFixed(3)}); pass widths ${width(r.candidate.pass).toFixed(3)} / ${width(r.incumbent.pass).toFixed(3)}`,
    );
  }, 120_000);

  it('a flaky machine (simulated stalls on measured trials) widens the interval and yields no false win', async () => {
    const stall = (ms: number, rng: () => number): number => (rng() < 0.4 ? ms * (1 + 5 * rng()) : ms);
    const r = await compare({ source: SUM, fnName: 'total' }, { source: SUM, fnName: 'total' }, arrays, { sandbox: sb, seed: 5, perturb: stall });
    const quiet = await compare({ source: SUM, fnName: 'total' }, { source: SUM, fnName: 'total' }, arrays, { sandbox: sb, seed: 5 });
    expect(r.perturbed).toBe(true);
    expect(r.overall.verdict).toBe('not-distinguished');
    expect(width(r.candidate.pass)).toBeGreaterThan(2 * width(quiet.candidate.pass));
    console.log(`flaky: pass width ${width(r.candidate.pass).toFixed(3)} vs quiet ${width(quiet.candidate.pass).toFixed(3)}`);
  }, 120_000);

  it('a function that sorts its input in place gets fresh copies every repetition', async () => {
    const dist: Distribution = { name: 'arrays', sizes: [200], gen: (n, rng) => [Array.from({ length: n }, () => randInt(rng, 0, 9999))] };
    const r = await bench(SORT_IN_PLACE, 'sorted', dist, { sandbox: sb, seed: 6, trials: 11 });
    expect(r.perSize[0]!.freshCopies).toBe(true);
  });

  it('sweep fits a log-log slope with an interval (quadratic function near 2)', async () => {
    const r = await sweep(QUAD, 'pairs', (n, rng) => [Array.from({ length: n }, () => randInt(rng, 0, 1 << 20))], {
      sandbox: sb,
      seed: 7,
      kMin: 6,
      kMax: 9,
      trials: 15,
      inputsPerSize: 4,
    });
    expect(r.points.map((p) => p.n)).toEqual([64, 128, 256, 512]);
    expect(r.logLogSlope.estimate).toBeGreaterThan(1.6);
    expect(r.logLogSlope.estimate).toBeLessThan(2.4);
    console.log(`sweep pairs: slope ${r.logLogSlope.estimate.toFixed(3)} (95% CI ${r.logLogSlope.lo.toFixed(3)}-${r.logLogSlope.hi.toFixed(3)})`);
  }, 120_000);
});
