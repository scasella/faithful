/**
 * Statistics for the benchmark: medians, seeded percentile-bootstrap 95% confidence intervals of a median, of a ratio
 * of medians and of a log-log slope, and the "faster" verdict. Pure functions; no timing here.
 *
 * "Faster" is defined by NON-OVERLAPPING intervals: the candidate's 95% CI of the median lies entirely below the
 * incumbent's. Overlapping intervals are "not distinguished", whatever the point estimates say.
 */
import { mulberry32, type Rng } from './rng.js';

/** The minimum number of bootstrap resamples this module accepts. */
export const MIN_RESAMPLES = 2000;

export interface Interval {
  /** Point estimate on the full sample. */
  estimate: number;
  /** 95% percentile-bootstrap interval. */
  lo: number;
  hi: number;
}

export interface BootstrapOptions {
  seed: number;
  /** >= 2000. Default 2000. */
  resamples?: number;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('median of an empty sample');
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Linear-interpolated percentile (p in [0, 1]) of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('percentile of an empty sample');
  const x = p * (sorted.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < sorted.length ? sorted[i]! * (1 - f) + sorted[i + 1]! * f : sorted[i]!;
}

function resamples(opts: BootstrapOptions): number {
  const r = opts.resamples ?? MIN_RESAMPLES;
  if (!Number.isInteger(r) || r < MIN_RESAMPLES) throw new RangeError(`bootstrap needs at least ${MIN_RESAMPLES} resamples (got ${r})`);
  return r;
}

function resample(xs: readonly number[], rng: Rng, out: number[]): number[] {
  const n = xs.length;
  for (let i = 0; i < n; i++) out[i] = xs[Math.floor(rng() * n)]!;
  return out;
}

function interval(estimate: number, stats: number[]): Interval {
  stats.sort((a, b) => a - b);
  return { estimate, lo: percentile(stats, 0.025), hi: percentile(stats, 0.975) };
}

/** Median with a seeded percentile-bootstrap 95% CI. */
export function bootstrapMedian(xs: readonly number[], opts: BootstrapOptions): Interval {
  const B = resamples(opts);
  const rng = mulberry32(opts.seed);
  const buf: number[] = new Array(xs.length);
  const stats: number[] = [];
  for (let b = 0; b < B; b++) stats.push(median(resample(xs, rng, buf)));
  return interval(median(xs), stats);
}

/**
 * Ratio median(num) / median(den) with a 95% CI from resampling both samples independently. With `num` = incumbent
 * times and `den` = candidate times this is the candidate's speed-up.
 */
export function bootstrapRatio(num: readonly number[], den: readonly number[], opts: BootstrapOptions): Interval {
  const B = resamples(opts);
  const rng = mulberry32(opts.seed);
  const bn: number[] = new Array(num.length);
  const bd: number[] = new Array(den.length);
  const stats: number[] = [];
  for (let b = 0; b < B; b++) stats.push(median(resample(num, rng, bn)) / median(resample(den, rng, bd)));
  return interval(median(num) / median(den), stats);
}

export type Verdict = 'faster' | 'slower' | 'not-distinguished';

/** Candidate vs incumbent by their intervals of median time: faster only when the candidate's interval is entirely below. */
export function verdict(candidate: Interval, incumbent: Interval): Verdict {
  if (candidate.hi < incumbent.lo) return 'faster';
  if (candidate.lo > incumbent.hi) return 'slower';
  return 'not-distinguished';
}

/** Least-squares slope of y on x. */
export function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) throw new RangeError('slope needs at least two points');
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  return sxy / sxx;
}

/**
 * Slope of log(median time) against log(n), with a 95% CI from resampling the trials at every size independently.
 * An empirical exponent over the measured sizes only; it is not an asymptotic bound.
 */
export function bootstrapLogLogSlope(points: ReadonlyArray<{ n: number; samples: readonly number[] }>, opts: BootstrapOptions): Interval {
  const B = resamples(opts);
  const rng = mulberry32(opts.seed);
  const lx = points.map((p) => Math.log(p.n));
  const est = slope(lx, points.map((p) => Math.log(median(p.samples))));
  const bufs = points.map((p) => new Array<number>(p.samples.length));
  const stats: number[] = [];
  for (let b = 0; b < B; b++) {
    stats.push(slope(lx, points.map((p, i) => Math.log(median(resample(p.samples, rng, bufs[i]!))))));
  }
  return interval(est, stats);
}
