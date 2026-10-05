/**
 * Benchmarks a TypeScript function inside the engine Sandbox on a declared input distribution.
 *
 * Method (per size of the distribution):
 *  - `gen(size, rng)` draws `inputsPerSize` argument lists (seeded). Each is probed once: an input on which the function
 *    faults is an error (nothing to time); an input the function mutates switches the size to "fresh copies" mode.
 *  - Timing happens in the worker: the source is loaded with an appended harness function that calls the target
 *    `reps` times over the inputs (fixed arity, a cheap sink so the calls are not dead code). One trial is one sandbox
 *    call; its duration is the worker's `performance.now()` around that call (`CallResult.ms`); argument cloning is
 *    outside the timed region. In fresh-copies mode the harness receives `reps` independent copies of the inputs, so
 *    an in-place `sort` does the same work every repetition.
 *  - `reps` is calibrated by doubling until one trial takes at least `minTrialMs`; then warm-up trials run for
 *    `warmupMs` (at least 3) and `reps` is calibrated again (JIT-optimized code is faster); then `trials` measured trials. The per-call time of a trial is trialMs / (reps x inputs).
 *  - Median per-call time with a seeded percentile-bootstrap 95% CI (>= 2000 resamples).
 *  - The distribution as a whole: per trial, the sum over sizes of (per-call time x inputsPerSize), i.e. the time of
 *    one pass over the generated sample; median with its 95% CI.
 *
 * compare(candidate, incumbent): same inputs, trials interleaved ABBA in one sandbox so drift and noise hit both.
 * Speed-up = median(incumbent) / median(candidate) with a bootstrap CI of the ratio. The verdict is "faster" only when
 * the two 95% intervals of median time do not overlap (stats.ts `verdict`).
 *
 * sweep(): sizes n = 2^k, log-log slope of median time against n with a bootstrap CI. Reported as a slope over the
 * measured sizes, never as an asymptotic class.
 *
 * Every report carries the interval(s), the number of trials, the sizes, the Node version and the date.
 */
import type { Val } from '@faithful/translate';
import { Sandbox } from '../sandbox/sandbox.js';
import { mulberry32, type Rng } from './rng.js';
import { bootstrapLogLogSlope, bootstrapMedian, bootstrapRatio, verdict, type Interval, type Verdict } from './stats.js';

export interface Distribution {
  name: string;
  sizes: number[];
  /** One argument list for the function, of the given size. */
  gen: (size: number, rng: Rng) => Val[];
}

export interface BenchOptions {
  seed?: number;
  /** Measured trials per size (per function). Default 31. */
  trials?: number;
  /** Warm-up time per size (per function), ms. Default 150. At least 3 warm-up trials run. */
  warmupMs?: number;
  /** Minimum duration of one trial, ms. Default 15. */
  minTrialMs?: number;
  /** Argument lists drawn per size. Default 16. */
  inputsPerSize?: number;
  /** Bootstrap resamples (>= 2000). Default 2000. */
  resamples?: number;
  /** Wall-clock budget for one trial call, ms. Default 30000. */
  trialTimeoutMs?: number;
  /** Use this sandbox instead of opening (and closing) a private one. */
  sandbox?: Sandbox;
  /**
   * Value domain of the probe load (see `LoadOptions.values`): `'js'` lets a function outside the verifiable subset return
   * non-integer numbers without its benchmark inputs being called faults. The timed harness is unaffected (it returns
   * an integer sink); benchmark inputs must be plain finite JSON values.
   */
  values?: 'subset' | 'js';
  /**
   * TEST HOOK, simulates a noisy machine: every measured trial duration (ms) is passed through this function before
   * any statistic is computed. Reports produced with it set `perturbed: true`.
   */
  perturb?: (ms: number, rng: Rng) => number;
}

export interface SizeResult {
  size: number;
  inputs: number;
  /** Calls of the function per trial = reps x inputs. */
  reps: number;
  /** The function mutates its inputs: each repetition got its own copy. */
  freshCopies: boolean;
  /** Calibration could not reach minTrialMs within the copy budget (fresh-copies mode only). */
  belowMinTrial: boolean;
  /** Raw trial durations, ms. */
  trialMs: number[];
  /** Per-call time of each trial, microseconds. */
  perCallUs: number[];
  /** Median per-call time, microseconds, with its 95% CI. */
  perCall: Interval;
}

export interface BenchReport {
  fnName: string;
  distribution: string;
  sizes: number[];
  inputsPerSize: number;
  trials: number;
  warmupMs: number;
  minTrialMs: number;
  resamples: number;
  seed: number;
  /** Time of one pass over the generated sample (all sizes), ms per trial. */
  passMs: number[];
  /** Median pass time, ms, with its 95% CI. */
  pass: Interval;
  perSize: SizeResult[];
  node: string;
  platform: string;
  /** ISO timestamp. */
  date: string;
  perturbed: boolean;
}

export interface Speedup {
  /** median(incumbent) / median(candidate), with the bootstrap 95% CI of that ratio. > 1: candidate quicker. */
  ratio: Interval;
  /** By non-overlap of the two intervals of median time. */
  verdict: Verdict;
}

export interface CompareReport {
  distribution: string;
  candidate: BenchReport;
  incumbent: BenchReport;
  perSize: Array<{ size: number } & Speedup>;
  overall: Speedup;
  trials: number;
  sizes: number[];
  node: string;
  date: string;
  perturbed: boolean;
}

export interface FnRef {
  source: string;
  fnName: string;
}

const HARNESS = '__faithfulBenchHarness';
let runCounter = 0;

function harnessSource(source: string, fnName: string, arity: number): string {
  const args = Array.from({ length: arity }, (_, i) => `a[${i}]`).join(', ');
  return `${source}
;function ${HARNESS}(inputs: any[], reps: number, fresh: boolean): number {
  let sink = 0;
  if (fresh) {
    for (let k = 0; k < inputs.length; k++) {
      const a = inputs[k];
      try { if (${fnName}(${args}) === undefined) sink++; } catch (e) { sink += 2; }
    }
    return sink;
  }
  for (let r = 0; r < reps; r++) {
    for (let k = 0; k < inputs.length; k++) {
      const a = inputs[k];
      try { if (${fnName}(${args}) === undefined) sink++; } catch (e) { sink += 2; }
    }
  }
  return sink;
}
`;
}

interface Opts {
  seed: number;
  trials: number;
  warmupMs: number;
  minTrialMs: number;
  inputsPerSize: number;
  resamples: number;
  trialTimeoutMs: number;
  perturb?: (ms: number, rng: Rng) => number;
  values?: 'subset' | 'js';
}

function resolve(o: BenchOptions): Opts {
  const r: Opts = {
    seed: o.seed ?? 1,
    trials: o.trials ?? 31,
    warmupMs: o.warmupMs ?? 150,
    minTrialMs: o.minTrialMs ?? 15,
    inputsPerSize: o.inputsPerSize ?? 16,
    resamples: o.resamples ?? 2000,
    trialTimeoutMs: o.trialTimeoutMs ?? 30_000,
  };
  if (o.perturb) r.perturb = o.perturb;
  if (o.values) r.values = o.values;
  if (r.trials < 5) throw new RangeError('bench: at least 5 trials');
  return r;
}

/** Max copies of the inputs sent in one fresh-copies trial (bounds memory in the 256 MB worker). */
const MAX_FRESH_COPIES = 4096;

/** One function at one size, loaded and calibrated; `trial()` runs one timed trial. */
class Runner {
  reps = 1;
  fresh = false;
  belowMin = false;
  private constructor(
    private readonly sb: Sandbox,
    private readonly id: string,
    private readonly inputs: Val[][],
    private readonly o: Opts,
  ) {}

  static async create(sb: Sandbox, ref: FnRef, inputs: Val[][], o: Opts, tag: string): Promise<Runner> {
    const arity = inputs[0]?.length ?? 0;
    const probeId = `${tag}:probe`;
    const l0 = await sb.load(probeId, ref.source, ref.fnName, { values: o.values });
    if (!l0.ok) throw new Error(`bench: ${ref.fnName} does not load: ${l0.error}`);
    const probe = await sb.callBatch(probeId, inputs, { perCallMs: o.trialTimeoutMs });
    await sb.unload(probeId);
    let fresh = false;
    probe.results.forEach((r, i) => {
      if (r.outcome.tag === 'fault' || r.outcome.tag === 'range-violation') {
        throw new Error(`bench: ${ref.fnName} faults on benchmark input ${i} (${JSON.stringify(r.outcome)}); nothing to time`);
      }
      if (r.violations.some((v) => v.kind === 'input-mutation')) fresh = true;
    });
    const id = `${tag}:h`;
    const l = await sb.load(id, harnessSource(ref.source, ref.fnName, arity), HARNESS);
    if (!l.ok) throw new Error(`bench: harness for ${ref.fnName} does not load: ${l.error}`);
    const run = new Runner(sb, id, inputs, o);
    run.fresh = fresh;
    await run.calibrate();
    return run;
  }

  private async timeOnce(): Promise<number> {
    const args: Val[] = this.fresh
      ? // Distinct deep copies: structured cloning would keep repeated references shared.
        [Array.from({ length: this.reps }, () => JSON.parse(JSON.stringify(this.inputs)) as Val[][]).flat() as Val[], 1, true]
      : [this.inputs as Val[], this.reps, false];
    const r = await this.sb.call(this.id, args, { timeoutMs: this.o.trialTimeoutMs });
    if (r.outcome.tag !== 'ok') throw new Error(`bench: trial failed: ${JSON.stringify(r.outcome)}`);
    return r.ms;
  }

  private async calibrate(): Promise<void> {
    for (;;) {
      const ms = await this.timeOnce();
      if (ms >= this.o.minTrialMs) return;
      if (this.fresh && this.reps >= MAX_FRESH_COPIES) {
        this.belowMin = true;
        return;
      }
      const target = ms > 0.5 ? Math.ceil((this.reps * this.o.minTrialMs * 1.25) / ms) : this.reps * 2;
      let next = Math.max(this.reps * 2, Math.min(target, this.reps * 64));
      if (this.fresh) next = Math.min(next, MAX_FRESH_COPIES);
      this.reps = next;
    }
  }

  /** Warm-up trials for warmupMs (at least 3), then recalibrate: optimized code is faster than at first calibration. */
  async warmup(): Promise<void> {
    const t0 = performance.now();
    let n = 0;
    while (n < 3 || performance.now() - t0 < this.o.warmupMs) {
      await this.timeOnce();
      n++;
    }
    await this.calibrate();
  }

  trial(): Promise<number> {
    return this.timeOnce();
  }

  async close(): Promise<void> {
    await this.sb.unload(this.id);
  }
}

function genInputs(dist: Distribution, size: number, o: Opts, sizeIndex: number): Val[][] {
  const rng = mulberry32((o.seed * 0x9e3779b1 + sizeIndex * 0x85ebca6b) >>> 0);
  return Array.from({ length: o.inputsPerSize }, () => dist.gen(size, rng));
}

function sizeResult(size: number, run: Runner, inputs: number, trialMs: number[], o: Opts, salt: number): SizeResult {
  const calls = run.reps * inputs;
  const perCallUs = trialMs.map((ms) => (ms * 1000) / calls);
  return {
    size,
    inputs,
    reps: calls / inputs,
    freshCopies: run.fresh,
    belowMinTrial: run.belowMin,
    trialMs,
    perCallUs,
    perCall: bootstrapMedian(perCallUs, { seed: o.seed + salt, resamples: o.resamples }),
  };
}

function report(fnName: string, dist: Distribution, o: Opts, perSize: SizeResult[], date: string): BenchReport {
  const passMs = Array.from({ length: o.trials }, (_, t) =>
    perSize.reduce((acc, s) => acc + (s.perCallUs[t]! * s.inputs) / 1000, 0),
  );
  return {
    fnName,
    distribution: dist.name,
    sizes: [...dist.sizes],
    inputsPerSize: o.inputsPerSize,
    trials: o.trials,
    warmupMs: o.warmupMs,
    minTrialMs: o.minTrialMs,
    resamples: o.resamples,
    seed: o.seed,
    passMs,
    pass: bootstrapMedian(passMs, { seed: o.seed + 7919, resamples: o.resamples }),
    perSize,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    date,
    perturbed: o.perturb !== undefined,
  };
}

async function withSandbox<T>(given: Sandbox | undefined, f: (sb: Sandbox) => Promise<T>): Promise<T> {
  const sb = given ?? (await Sandbox.open({ defaultTimeoutMs: 30_000 }));
  try {
    return await f(sb);
  } finally {
    if (!given) await sb.close();
  }
}

/** Benchmark one function on a distribution. */
export async function bench(source: string, fnName: string, dist: Distribution, opts: BenchOptions = {}): Promise<BenchReport> {
  const o = resolve(opts);
  const date = new Date().toISOString();
  const noise = mulberry32((o.seed ^ 0xbadc0de) >>> 0);
  return withSandbox(opts.sandbox, async (sb) => {
    const perSize: SizeResult[] = [];
    for (const [si, size] of dist.sizes.entries()) {
      const inputs = genInputs(dist, size, o, si);
      const run = await Runner.create(sb, { source, fnName }, inputs, o, `bench${++runCounter}`);
      try {
        await run.warmup();
        const ms: number[] = [];
        for (let t = 0; t < o.trials; t++) {
          const raw = await run.trial();
          ms.push(o.perturb ? o.perturb(raw, noise) : raw);
        }
        perSize.push(sizeResult(size, run, inputs.length, ms, o, si));
      } finally {
        await run.close();
      }
    }
    return report(fnName, dist, o, perSize, date);
  });
}

function speedup(cand: number[], inc: number[], candI: Interval, incI: Interval, o: Opts, salt: number): Speedup {
  return { ratio: bootstrapRatio(inc, cand, { seed: o.seed + salt, resamples: o.resamples }), verdict: verdict(candI, incI) };
}

/** Compare a candidate with an incumbent on the same inputs; trials interleaved ABBA. */
export async function compare(candidate: FnRef, incumbent: FnRef, dist: Distribution, opts: BenchOptions = {}): Promise<CompareReport> {
  const o = resolve(opts);
  const date = new Date().toISOString();
  const noise = mulberry32((o.seed ^ 0xbadc0de) >>> 0);
  return withSandbox(opts.sandbox, async (sb) => {
    const pa: SizeResult[] = [];
    const pb: SizeResult[] = [];
    const perSize: CompareReport['perSize'] = [];
    for (const [si, size] of dist.sizes.entries()) {
      const inputs = genInputs(dist, size, o, si);
      const ra = await Runner.create(sb, candidate, inputs, o, `cmpA${++runCounter}`);
      const rb = await Runner.create(sb, incumbent, inputs, o, `cmpB${runCounter}`);
      try {
        await ra.warmup();
        await rb.warmup();
        const ma: number[] = [];
        const mb: number[] = [];
        for (let t = 0; t < o.trials; t++) {
          const order: Array<[Runner, number[]]> = t % 2 === 0 ? [[ra, ma], [rb, mb]] : [[rb, mb], [ra, ma]];
          for (const [r, into] of order) {
            const raw = await r.trial();
            into.push(o.perturb ? o.perturb(raw, noise) : raw);
          }
        }
        const sa = sizeResult(size, ra, inputs.length, ma, o, si);
        const sbr = sizeResult(size, rb, inputs.length, mb, o, si + 1000);
        pa.push(sa);
        pb.push(sbr);
        perSize.push({ size, ...speedup(sa.perCallUs, sbr.perCallUs, sa.perCall, sbr.perCall, o, si + 2000) });
      } finally {
        await ra.close();
        await rb.close();
      }
    }
    const a = report(candidate.fnName, dist, o, pa, date);
    const b = report(incumbent.fnName, dist, o, pb, date);
    return {
      distribution: dist.name,
      candidate: a,
      incumbent: b,
      perSize,
      overall: speedup(a.passMs, b.passMs, a.pass, b.pass, o, 3000),
      trials: o.trials,
      sizes: [...dist.sizes],
      node: process.version,
      date,
      perturbed: o.perturb !== undefined,
    };
  });
}

export interface SweepReport {
  fnName: string;
  points: Array<{ n: number; perCall: Interval; trials: number }>;
  /** Slope of log(median per-call time) against log(n) over the measured n, with its 95% CI. Not an asymptotic class. */
  logLogSlope: Interval;
  trials: number;
  node: string;
  date: string;
  perturbed: boolean;
}

/** Time the function at n = 2^k for k in [kMin, kMax] and fit a log-log slope. */
export async function sweep(
  source: string,
  fnName: string,
  gen: (n: number, rng: Rng) => Val[],
  opts: BenchOptions & { kMin?: number; kMax?: number } = {},
): Promise<SweepReport> {
  const kMin = opts.kMin ?? 6;
  const kMax = opts.kMax ?? 12;
  if (kMax - kMin < 2) throw new RangeError('sweep: need at least 3 sizes');
  const sizes = Array.from({ length: kMax - kMin + 1 }, (_, i) => 2 ** (kMin + i));
  const r = await bench(source, fnName, { name: `n = 2^${kMin}..2^${kMax}`, sizes, gen }, opts);
  const o = resolve(opts);
  return {
    fnName,
    points: r.perSize.map((s) => ({ n: s.size, perCall: s.perCall, trials: s.perCallUs.length })),
    logLogSlope: bootstrapLogLogSlope(r.perSize.map((s) => ({ n: s.size, samples: s.perCallUs })), { seed: o.seed + 4243, resamples: o.resamples }),
    trials: r.trials,
    node: r.node,
    date: r.date,
    perturbed: r.perturbed,
  };
}

