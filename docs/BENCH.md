# Benchmarks: method, limits, and a measured run

What "faster" means in Faithful, how the number behind it is measured (`packages/engine/src/benchmark/`), what it does
not claim, and a run of the real harness made for this document. Describes the code as of 2026-10-05; where this
document and the code differ, the code is what runs and this document is wrong.

## Method

### The declared distribution

A benchmark is always "on the declared distribution", and the distribution is shown with its sizes. The optimizer uses
the calibrated default, `calibrateDistribution` in `packages/cli/src/flow/distribution.ts`:

* **Values** for a size n (`genVal`): an integer parameter is uniform in [0, n]; a string is n lowercase ASCII letters;
  an array has n elements, integer elements uniform in [-n, n] and other element types generated at size min(n, 4); a
  boolean is a fair coin; tuples and records are generated field by field; an option-typed value is its inner type.
* **Preconditions**: each argument list is drawn up to 200 times until it satisfies the translator's preconditions and
  the carve-outs (compiled to JavaScript predicates); after 200 failures the last draw is used unfiltered, and the
  calibration step below screens such inputs.
* **Sizes**: the range-instrumented original is loaded in the sandbox and run on 6 argument lists at n = 2, 4, 8, ...,
  up to 4096 (seed `7 + n`). The time per call is the main thread's wall-clock time for that batch divided by 6, so it
  includes the round trip to the worker. The doubling stops at the first n where:
  * any of the 6 calls is a range violation, a fault or a throw: the previous n is kept ("sizes stop at ...: larger
    inputs leave the model's range or throw for this function"), or
  * the time per call reaches 1 ms: this n is kept ("sizes chosen so one call of the original takes about 1 ms at the
    largest size").

  If neither happens by 4096, n = 4096 and the note stays "sizes chosen by running the original". The sizes are
  {floor(n/4), floor(n/2), n} (at least 1, duplicates removed). The distribution's name lists each parameter, e.g.
  `auto: xs: array of n values`.

`bench`, `compare` and `sweep` accept any `Distribution` (`name`, `sizes`, `gen(size, rng)`); the calibrated default is
what the optimizer passes.

### Inputs and the probe

For each size, 16 argument lists (`inputsPerSize`) are drawn with `mulberry32((seed * 0x9e3779b1 + sizeIndex *
0x85ebca6b) >>> 0)`; the default seed is 1. In `compare` both functions get exactly the same inputs.

Each function is first run once on every input (`Runner.create`). A `fault` or `range-violation` on any input is an
error ("nothing to time"). If any call mutates an argument, that size runs in fresh-copies mode (below). The probe does
not compare the two functions' results; equivalence is the differential test's job, not the benchmark's.

### What one trial is

The source is loaded in the sandbox worker with an appended harness function that calls the target `reps` times over
the 16 inputs (fixed arity, each call inside `try`/`catch`, a cheap sink so the calls are not dead code). One trial is one
sandbox call of the harness. Its duration is the worker's `performance.now()` around that call (`CallResult.ms`); the
structured clone of the arguments into the worker happens before the timer starts. The per-call time of a trial is
trial duration / (reps × 16).

**Fresh copies.** When the function mutates its inputs, each repetition must see unmutated data. Then `reps` is the
number of deep copies of the 16 inputs (made with JSON on the main thread, outside the timed region; capped at 4,096),
and the harness makes one pass over all of them. If 4,096 copies do not reach the minimum trial length, the size is
marked `belowMinTrial`.

### Calibration, warm-up, trials

* **Inner-loop sizing** (`calibrate`): starting at reps = 1, time a trial; if it took at least `minTrialMs` (default
  15 ms), stop. Otherwise set reps to max(2 × reps, min(target, 64 × reps)), where target = ceil(reps × 15 × 1.25 / ms)
  when the trial took more than 0.5 ms and 2 × reps otherwise, and repeat.
* **Warm-up**: trials run until at least 3 have run and at least `warmupMs` (default 150 ms, main-thread clock) has
  passed; then `reps` is calibrated again, because JIT-optimized code is faster than at the first calibration.
* **Measured trials**: `trials` (default 31; fewer than 5 is refused).

### Statistics

* **Median with a 95% CI** per size: percentile bootstrap of the median of the per-call times, 2,000 resamples (the
  module refuses fewer, `MIN_RESAMPLES`), seeded `mulberry32`; the interval is the linearly interpolated 2.5th and 97.5th
  percentiles of the resampled medians. Seeds are derived from the run seed: seed + size index for the candidate,
  seed + size index + 1000 for the incumbent.
* **Pass time** (the whole distribution): for trial t, the sum over sizes of per-call time × 16, i.e. the time of one
  pass over the generated sample, in ms. Median and bootstrap 95% CI as above (seed + 7919).
* **Verdict** (`verdict` in `stats.ts`): `faster` only when the candidate's interval (95% CI) of median time lies entirely
  below the incumbent's (candidate.hi < incumbent.lo); `slower` when entirely above; otherwise `not-distinguished`,
  whatever the point estimates say.
* **Speed-up**: median(incumbent) / median(candidate), with a 95% CI from resampling the two samples independently
  (seed + size index + 2000 per size, seed + 3000 overall). This interval is computed separately from the verdict: it can
  exclude 1 while the verdict is `not-distinguished` (the noise run below has one such case), and the verdict, not the
  ratio interval, decides "faster".
* **What decides**: the optimizer and the evidence line use the overall verdict and ratio, computed from pass times.
  Per-size verdicts and ratios are reported alongside but decide nothing; there is no correction for looking at several
  sizes.

### Interleaving

`compare` loads both functions into the same sandbox worker. Probe, calibration and warm-up run one function after the
other (candidate first). Only the measured trials are interleaved: trial t runs candidate then incumbent when t is even
and incumbent then candidate when t is odd (A B, B A, A B, ...), so slow drift and periodic noise fall on both.

### Where the optimizer uses it

`Optimizer.run` benchmarks the original with `bench` on the calibrated distribution (its median pass time is the
"timing" string shown in the candidate prompt), then each candidate that passed the differential stage is compared
with `compare` against the original and, when there is an incumbent, against the incumbent. A candidate becomes the
incumbent only if it is proved against the spec **and** its verdict against the current incumbent is `faster`. The
speed-up stored on the candidate, and quoted in the delivered evidence line, is the one against the original.

`sweep` (sizes 2^k, log-log slope of median time against n with a bootstrap 95% CI) exists in the engine and is
reported as a slope over the measured sizes only, never as an asymptotic class; the optimizer does not call it.

One labeling detail: `toSummary` in `packages/cli/src/flow/optimize.ts` stores the pass-time median multiplied by 10^6
with `unit: 'ns/pass'`. The value is nanoseconds per pass over the whole sample (all sizes, 16 inputs each), not per
call.

## What it does not claim

* It is not a general performance claim. It is a statement about the declared distribution (those parameter shapes,
  those sizes, those 16 inputs per size), on the measuring machine, under the Node version in the report.
* Results depend on the Node/V8 version, the machine, its load, power and thermal state. Every report carries the Node
  version, platform and date; reproduce on your own machine before relying on a ratio.
* It is a microbenchmark of one function in a worker thread under the purity mask (`Math` and `Date` are wrapped
  objects there). Inlining, allocation and GC behaviour inside your application can differ.
* When per-call times are a few nanoseconds, the harness loop's own cost (call, `try`/`catch`, sink) is a large part
  of what is measured, so the ratio there understates or distorts the function's own difference.
* Different sizes amplify different costs: a ratio over a pass is dominated by the largest size when the work grows
  with n.
* "Not distinguished" is not "equally fast". It says the two intervals (each a 95% CI) overlap at this trial count.
* The calibration stops at the first throwing input, so functions that throw on larger inputs are benchmarked only on
  sizes below that point.

## Measured run (2026-10-05)

Produced for this document by running the built harness (`packages/engine/dist/benchmark/bench.js`, `compare`) with the
calibrated default distribution (`packages/cli/dist/flow/distribution.js`, `calibrateDistribution`) on four corpus
functions from `packages/translate/corpus`, each against a hand-written equivalent. One shared
`Sandbox.open({ defaultTimeoutMs: 30_000 })`, every other option at its default: seed 1, 31 measured trials per size
per function, warm-up at least 150 ms and 3 trials, minimum trial 15 ms, 16 inputs per size, 2,000 bootstrap resamples.
No size ran in fresh-copies mode; no size was `belowMinTrial`.

* Date: 2026-10-05, compare reports stamped 09:20:58Z to 09:22:33Z (UTC); whole script, including the noise run,
  4 min 8 s.
* Node v25.8.1, darwin-arm64.
* Machine (`sysctl`): Apple M4 Pro (`machdep.cpu.brand_string`), model Mac16,7, `hw.ncpu` 14, `hw.memsize`
  25769803776 (24 GB); macOS 27.0.1 (26A434). An interactive desktop session, not an isolated benchmark machine.

The candidates:

| Corpus function | Original | Hand-written candidate |
|---|---|---|
| `numeric/fibRecursive` | naive double recursion | `if (n < 2) return n;` then an iterative loop with two accumulators |
| `array/sum` | `xs.reduce((acc, x) => acc + x, 0)` | indexed `for` loop |
| `array/dedupe` | loop with `includes`, growing the result by `concat` | `words.filter((w, i) => words.indexOf(w) === i)` |
| `numeric/aliquotSum` | loop, `sum = sum + i` | the same loop with `sum += i` (the control pair: no speed difference expected) |

### Overall (pass over the whole sample; this is what decides)

| Function | Distribution and sizes | Original, ms per pass, median (95% CI) | Candidate, ms per pass, median (95% CI) | Speed-up (95% CI) | Verdict |
|---|---|---|---|---|---|
| fibRecursive | `auto: n: integer in [0, n]`, sizes 8, 16, 32 (about 1 ms per call at 32) | 22.368 (21.389–22.515) | 0.00021 (0.00021–0.00021) | 106,417.7 (101,148.4–108,044.6) | faster |
| sum | `auto: xs: array of n values`, sizes 1024, 2048, 4096 (4096 reached without 1 ms) | 0.04620 (0.04483–0.04740) | 0.04272 (0.04224–0.04336) | 1.081 (1.042–1.115) | faster |
| dedupe | `auto: words: array of n values`, sizes 256, 512, 1024 (about 1 ms per call at 1024) | 26.018 (25.771–26.301) | 17.392 (17.296–17.632) | 1.496 (1.466–1.515) | faster |
| aliquotSum | `auto: n: integer in [0, n]`, sizes 1024, 2048, 4096 (4096 reached without 1 ms) | 0.05763 (0.05747–0.05770) | 0.05748 (0.05738–0.05769) | 1.003 (0.998–1.005) | not distinguished |

For aliquotSum the candidate's interval (0.05738–0.05769) overlaps the original's (0.05747–0.05770), so the verdict is
`not-distinguished` and the evidence line would read "No speed difference distinguished on the declared distribution".

### Per size (reported, does not decide)

Per-call median in microseconds (95% CI); `reps` is the calibrated number of passes over the 16 inputs per trial.

| Function | n | Original µs (95% CI), reps | Candidate µs (95% CI), reps | Speed-up (95% CI) | Verdict |
|---|---|---|---|---|---|
| fibRecursive | 8 | 0.0316 (0.0314–0.0330), 36,570 | 0.0025 (0.0025–0.0025), 430,982 | 12.64 (12.54–13.23) | faster |
| fibRecursive | 16 | 0.8982 (0.8926–0.9016), 1,312 | 0.0041 (0.0041–0.0042), 292,270 | 218.0 (215.8–220.7) | faster |
| fibRecursive | 32 | 1,397.06 (1,335.87–1,406.28), 2 | 0.0065 (0.0063–0.0066), 179,048 | 216,010 (206,549–221,132) | faster |
| sum | 1024 | 0.4213 (0.4098–0.4322), 2,794 | 0.3900 (0.3783–0.4051), 2,964 | 1.080 (1.024–1.119) | faster |
| sum | 2048 | 0.8059 (0.7990–0.8150), 1,407 | 0.7538 (0.7456–0.7911), 2,336 | 1.069 (1.019–1.090) | faster |
| sum | 4096 | 1.6019 (1.5842–1.6768), 804 | 1.4870 (1.4744–1.5039), 822 | 1.077 (1.055–1.132) | faster |
| dedupe | 256 | 87.334 (85.878–88.624), 12 | 54.244 (53.890–55.058), 20 | 1.610 (1.570–1.639) | faster |
| dedupe | 512 | 314.19 (309.31–318.26), 4 | 208.86 (208.03–210.51), 5 | 1.504 (1.478–1.526) | faster |
| dedupe | 1024 | 1,213.41 (1,197.88–1,230.72), 1 | 822.39 (815.04–835.73), 2 | 1.475 (1.440–1.508) | faster |
| aliquotSum | 1024 | 0.6175 (0.6142–0.6214), 2,225 | 0.6144 (0.6115–0.6176), 2,217 | 1.005 (0.996–1.013) | not distinguished |
| aliquotSum | 2048 | 1.0767 (1.0742–1.0824), 1,038 | 1.0747 (1.0721–1.0782), 1,044 | 1.002 (0.997–1.008) | not distinguished |
| aliquotSum | 4096 | 1.9053 (1.8971–1.9089), 611 | 1.9065 (1.9036–1.9127), 604 | 0.999 (0.995–1.002) | not distinguished |

Reading notes. The fibRecursive candidate runs in a few nanoseconds per call, which is at the scale of the harness
loop itself, and the original's pass time is dominated by n = 32; the overall ratio says the iterative version is
faster on this distribution by a very large factor and should not be read more precisely than that. The sum pair
(reduce vs indexed loop) came out faster by about 1.08 on this machine and Node version; that is a measured result on
this run, not a rule.

**Equivalence check behind the table.** The benchmark probe does not compare results, so each pair was also run through
the engine's differential test (`tsVsTs`, original instrumented) in the same script: on the 48 benchmark inputs (3 sizes
× 16) every pair had 0 disagreements on 48 compared inputs; on 1,000 inputs generated under the translator's
preconditions (`generateInputs`, seed 7001, 500 ms per call), 0 disagreements for every pair, on 526 compared inputs
for fibRecursive (408 outside the model's range, 66 where the original faulted), 951 for sum (49 out of range), 1,000
for dedupe, 873 for aliquotSum (127 where the original faulted). This is testing, not a proof of equivalence.

### Noise: a function against itself

The same function was compared with itself (`compare(f, f)`, same source as candidate and incumbent) 10 times, seeds 1
to 10, with the calibrated distribution and default options, for two functions:

| Function | Sizes | Runs | Overall `faster` | Overall `slower` | Overall `not-distinguished` | Per-size verdicts not `not-distinguished` |
|---|---|---|---|---|---|---|
| sum | 1024, 2048, 4096 | 10 | 0 of 10 | 0 of 10 | 10 of 10 | 0 of 30 |
| fibRecursive | 8, 16, 32 | 10 | 0 of 10 | 0 of 10 | 10 of 10 | 0 of 30 |

The overall verdict was `faster` 0 of 10 times for each function. Across the ten runs the overall speed-up estimates
lay between 0.992 and 1.013 for sum (lowest interval bound 0.969, highest 1.029) and between 0.988 and 1.004 for
fibRecursive (lowest bound 0.979, highest 1.018). In one of the 20 runs
(fibRecursive, seed 1: speed-up 0.988, 95% CI 0.979–0.998) the ratio interval excluded 1 while the verdict was
`not-distinguished`, which is the case the method section describes: the verdict comes from the two median intervals,
not from the ratio interval. Twenty runs on one machine show the false-alarm rate is low here; they do not bound it.

### Reproducing

The script used is not part of the repository. To reproduce, build (`pnpm build`), then for a corpus function: translate
it (`translate` from `@faithful/translate`), open a `Sandbox`, call `calibrateDistribution(translation, [], sandbox)`, and
call `compare({ source: candidate, fnName }, { source: translation.plainTs, fnName }, calibrated.distribution,
{ sandbox })`. Expect different absolute numbers on a different machine or Node version.
