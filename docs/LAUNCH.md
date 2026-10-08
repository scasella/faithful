# Faithful: launch report

Date: 2026-10-05. Model `gpt-6-luna` through Codex CLI 0.159.2. Toolchain: Node v25.8.1, TypeScript 5.9.3, Lean 4.34.0,
Mathlib `5ed2965256430c3649e86755f9576b54eca72435`, Z3 via `z3-solver` 5.2.0 (WASM) or system Z3 5.1.0, macOS arm64.
The generated tables below carry their own stamp, read from the results files.

This report states what was built, what was measured, and what is not known. Every number in it comes from a results
file under `docs/measurements/`, from a document that cites one (docs/PROOFS.md, docs/TRANSLATOR.md, docs/SMT.md), or
from the generated tables region near the end. Anything not yet measured is not stated. Counts only: there are no
percentages in this report, and the only percent sign is the one in "95% CI".

Contents

1. What was built
2. The claim, and the five labels
3. Subset coverage
4. Agreement: disagreements and rulings
5. Original-proof success
6. Candidate proofs
7. Optimization campaign
8. Benchmarks and how numbers are printed
9. The SMT tier
10. Red-team history
11. Deviations from the brief
12. Z3 in the browser
13. Security
14. Known limitations, and what each tier does not mean
15. Reproducing
16. Tables (generated)

---

## 1. What was built

Faithful takes one exported TypeScript function, translates it with a fixed, deterministic translator (no model call) into
a Lean 4 model, asks the model `gpt-6-luna` to propose a spec that the user agrees to (after a challenge run that looks
for inputs where spec and code disagree), asks the model for a Lean proof that the original meets the agreed spec, and
then asks the model for faster rewrites. Each candidate rewrite goes through a funnel:

compile (strict TypeScript, same signature) → purity (sample inputs, each called twice) → differential test against the
original (up to 1,000 generated inputs) → SMT bounded equivalence (where wired, see section 9) → benchmark against the
original and the current best → Lean proof against the agreed spec, attempted only for a candidate that is
significantly faster than the current best.

Delivery is a patch plus a provenance file and `VERIFY.md`; the user's source files are never modified.
`faithful verify` re-checks a delivered result without trusting it.

Packages (dependency direction in docs/DESIGN.md):

| package | role |
|---|---|
| `packages/core` | tier vocabulary and the Proved sentence, toolchain snapshot (`Stamp`), subprocess runner, `.faithful` store |
| `packages/translate` | TypeScript subset v1 → Lean 4 model and the range-check twin; deterministic (docs/TRANSLATOR.md) |
| `packages/engine` | sandbox, differential and mutation testers, benchmark, evidence line |
| `packages/smt` | translator IR → SMT-LIB, Z3 drivers, bounded equivalence ("Verified to k", docs/SMT.md) |
| `packages/prover` | Lean project, proof checking, axiom classification, Codex driver, spec and proof generation (docs/PROOFS.md) |
| `packages/session` | event-sourced session state shared by the CLI, the UI and the showcase |
| `packages/cli` | `faithful` commands, the local server and the autopilot used for measurements |
| `apps/ui` | browser UI (Preact + Vite) served by the CLI: Select, Translate, Agree, Prove original, Optimize, Deliver |
| `apps/showcase` | static site that replays recorded sessions and re-runs the funnel live in the browser |
| `lean/` | Lake project pinning Lean and Mathlib; the `Faithful` runtime library and tactic set |

## 2. The claim, and the five labels

Every claim carries exactly one label (`TIER_LABEL` in `packages/core/src/tiers.ts`), strongest first:

| label | in one line (full definition: [docs/TIERS.md](TIERS.md)) |
|---|---|
| Proved | Lean accepted a Faithful-written theorem about the Lean model and the agreed spec, with only the standard axioms |
| Proved (trusting the compiler) | as Proved, but the proof uses `native_decide`, so Lean's compiler is in the trusted base |
| Verified to k | Z3 found no input inside stated bounds (arrays and strings up to k, integers in a stated range, U iterations) where the candidate differs from the original |
| Tested | the candidate passed compile, purity and the differential test on the generated inputs, and nothing stronger |
| Not proved | no accepted proof exists; this is the absence of a claim, not evidence of a bug |

"Proved" never appears without this sentence (`provedSentence(N)`):

> Proved for the Lean model of this function. The model is produced by a fixed translator (docs/TRANSLATOR.md) and checked against the TypeScript on N inputs.

Faithful never says a TypeScript function was proved on every input. The proof is about the Lean model; the link to the
TypeScript is the translator's design and the differential check on N inputs.

## 3. Subset coverage

The translator accepts subset v1 (docs/TRANSLATOR.md). Refusals are findings; the subset was not widened to improve
numbers.

**Corpus** (`packages/translate/corpus`, 74 functions, each labeled independently of the translator): 39 of 74 are in the
subset. Of the 44 labeled `expect=ok`, 39 are accepted and 5 are refused; those 5 are translator gaps (four termination
measures the finder does not recognize and one measured through a local: numeric/gcd, recursive/gcd,
array/binarySearch, string/isPalindrome, recursive/digitSum). All 30 functions labeled `expect=refuse` are refused with
the labeled code. Label/translator mismatches: none. Refusal histogram: docs/TRANSLATOR.md section 12 and the tables.

**Library sample** (`packages/translate/library-sample`, 20 functions copied verbatim from es-toolkit, radash and
remeda; NOTICE.md): 0 of 20 are in the subset. Refusals:

| code | functions |
|---|---|
| unsupported-syntax | 13 (7 overloaded functions, 5 module-level statements or imports, 1 missing module constant) |
| generic | 5 |
| unsupported-type | 1 |
| missing-annotation | 1 |

Plainly: the subset covers small, self-contained integer, array and string functions written for it; real library code,
as sampled, falls outside it (overloads, generics, module structure). Such functions can still be optimized on the
Tested tier only (`faithful optimize --tested`), with no spec, proof or SMT check.

## 4. Agreement: disagreements and rulings

The spec is proposed by the model and agreed by the user after a challenge run. In every measurement here the user was
the autopilot (`packages/cli/src/flow/autopilot.ts`, section 11): it models a throw site as a precondition, asks for at
most two revisions when a disagreement shows the spec is wrong, and never accepts a faster-but-not-proved candidate. A
function whose revisions do not converge is blocked at agreement and counted as not proved. Counts: see tables.

## 5. Original-proof success

From docs/PROOFS.md, which holds the split rule, the per-class tables and the cost:

* Baseline (effort `low`, 6 attempts / 6 minutes): 3 of the 39 in-subset functions proved.
* Tuning used 13 TUNE functions, chosen by a fixed rule before any run (ids sorted, index mod 3 = 1). The held-out 26
  were run once with the shipped defaults (effort `high`, prompt guide, `Faithful.Simp`, 10 attempts / 12 minutes):
  **1 of 26 at baseline → 12 of 26.** Four of the 26 were blocked at agreement in both runs and count as not proved.
* Run-to-run noise between runs of the same configuration is about ±2 functions (13 TUNE functions with a freshly
  proposed spec each run), so only the effort lever's effect is clearly larger than noise.
* About 7 of the 12 held-out proofs fit the old 6-attempt / 6-minute budget; the rest needed the larger budget. A
  function that is not proved costs the whole budget (typically 10-13 minutes at effort `high`).

The baseline and held-out rows are reproduced from their results files in the tables.

## 6. Candidate proofs

A candidate is proved against the agreed spec only when it is significantly faster than the current best. Runs:
`docs/measurements/2026-10-05-cproofs-*` (`tune-final-default` is the final configuration). Counts and medians: see
tables.

## 7. Optimization campaign

`docs/measurements/2026-10-05-campaign/results.jsonl`: the whole workflow under the autopilot, one line per corpus
function. It may still be running when the tables are generated; the tables then say "partial: N of M functions".
Counts of candidate outcomes, "faster, not proved" candidates, best, median and worst speedups with their 95% CI and
distribution, tiers of the best results, wall time, Codex calls, blocked-at-agreement and errors: see tables. Nothing in
this section is a number until the tables say so.

## 8. Benchmarks and how numbers are printed

Method and limits: [docs/BENCH.md](BENCH.md). A speedup is a statement about the declared distribution of that function
(parameter shapes, sizes, inputs), on the measuring machine and Node version, never a general performance claim. "Not
distinguished" is not "equally fast".

"Faster" is said only when the benchmark verdict is faster (the 95% CI of the two median times do not overlap) and the
speedup interval, as printed, lies above 1. Printing never rounds up a claim: a point estimate and a lower bound are
rounded down, an upper bound up; a ratio within 0.5 of 1 gets at least two decimals, and more until a "faster" lower
bound prints above 1 (so a measured 1.10 with interval 1.04–1.16 prints as "1.10× faster (95% CI 1.04–1.16)", not as
"1.1× ... 1.0–1.2"). When no such printing exists, no speed claim is made. This rule is in `apps/ui/src/lib/format.ts`
and `packages/engine/src/evidence/evidence.ts`, with tests.

## 9. The SMT tier

"Verified to k" compares candidate with original, both encoded from the translator's IR, inside bounds stated with
every claim (arrays and strings up to k, integers within a range, at most U iterations per loop entry and U nested
recursive calls; inputs needing more than U are excluded and the coverage check says so). It says nothing about the
spec and nothing outside the bounds. Definition and limits: [docs/SMT.md](SMT.md).

Wiring, as the code stands today: the SMT checker (`packages/cli/src/smtChecker.ts`) is set on the session runtime by
the UI server (`packages/cli/src/api.ts`), by `faithful showcase-record` and by `scripts/measure.mjs`. The headless
`faithful optimize` command does not set it (its SMT stage is recorded as skipped), and `faithful verify` reports a
recorded Verified-to-k claim as "NOT re-checked". docs/TIERS.md ("Status in this build") and docs/SMT.md section 1 still
say the CLI never calls the SMT tier; that text predates the wiring and is stale for the UI server and measure.mjs.

## 10. Red-team history

**Translator.** Four rounds of adversarial probes (1,131 probe files) found 26, 10, 17 and 15 divergence files in rounds
1 to 4; every divergence probe of every round passes now. Red-teaming **stopped after round 4 by decision, not because
it ran dry**: each round kept finding new, increasingly exotic cases, and there is no evidence that a fifth round would
find nothing. Details: docs/TRANSLATOR.md section 13.

**SMT.** Three rounds. Rounds 1 and 2 found real bugs (7 and 3), including a false `unsat` on vacuous queries: a pair
that differs on every input was reported "Verified to k" because the checked set was empty; fixed by a non-emptiness
section and the coverage check. Round 3 ran 408 probes and found 0 bugs. That covers the probes listed; it is not
evidence that a further round would find nothing. Details: docs/SMT.md section 10.

## 11. Deviations from the brief

1. **Funnel order: benchmark before proof.** A candidate's Lean proof is attempted only when it is significantly faster
   than the current best, so proof time is not spent on candidates that could not become the result.
2. **Stagnation stop.** The optimizer stops after 3 rounds without a new candidate (duplicates count as none), besides
   the time budget and the speed target.
3. **High proof effort.** Proof attempts run at effort `high` by default (spec and candidate calls at `low`); each
   attempt takes 30-95 s instead of 7-20 s. Chosen by the tuning experiment (docs/PROOFS.md).
4. **Proof budgets.** CLI, API and UI all default to 10 attempts / 12 minutes per proof (the UI default was 3 / 5 until
   2026-10-05 and now matches the backend; the UI shows the budget in plain words before a proof starts). The candidate
   proof flow uses its own budget (docs/measurements/2026-10-05-cproofs-*/config.json).
5. **SMT bounded by U.** Loops and recursion are unrolled to U; inputs needing more are excluded and the claim says so
   (section 9). Not wired into headless `faithful optimize` or `faithful verify`.
6. **Autopilot as the user.** Every measurement uses the scripted user policy in `packages/cli/src/flow/autopilot.ts`,
   recorded in each result. A real user who rules differently gets different specs and different proof difficulty.
7. **Z3 in the browser only with cross-origin isolation** (section 12).
8. **Candidates outside the subset reach only Tested.** A candidate the translator refuses has no Lean model, so it
   cannot be proved or SMT-checked; the same holds for every candidate of a refused function on the Tested-only path.
9. **The sandbox is not a security boundary** (section 13).
10. Added `packages/core`, and SMT encodes the translator's IR rather than Lean text (docs/DESIGN.md, "Deviations").

## 12. Z3 in the browser

`z3-solver` 5.2.0 is an emscripten pthreads build and needs `SharedArrayBuffer`, i.e. cross-origin isolation. On static
hosting the showcase gets it from the vendored coi-serviceworker 0.1.7 (MIT; NOTICE.md), which reloads the page once on
the first visit. With it, Z3 works in the browser (measured in headless Chrome 154 on this Mac: about 105-165 ms per
query including WASM start). Without isolation, Z3 fails on the first query and the showcase shows the SMT stage as "not
available here". Only headless Chrome 154 was tested; Firefox and Safari were not. Details: apps/showcase/NOTES.md.

## 13. Security

Full text: [docs/SECURITY.md](SECURITY.md). The execution sandbox (a Node worker with realm hardening and a purity mask)
catches accidental impurity and the known escapes it was tested against; it is **not a security boundary**, and
model-written code runs on your machine with your user's rights. Nothing leaves the machine except the prompts to Codex,
which are shown verbatim under every proposal and attempt ("What the model saw"). Codex runs read-only in an empty
temporary directory; proof text is vetted before Lean sees it.

## 14. Known limitations, and what each tier does not mean

What each label does **not** mean is in [docs/TIERS.md](TIERS.md); in short:

* **Proved** is about the Lean model and the agreed spec under the stated preconditions (integers within ±2^53, BMP
  strings, in-range indices, carve-outs, ...). It is not a statement about the TypeScript on every input, it does not
  mean the spec is what you wanted, and it says nothing about speed.
* **Proved (trusting the compiler)** is weaker than Proved: a bug in Lean's compiler or runtime could make it false.
* **Verified to k** says nothing outside its bounds and nothing about the spec; it is not a proof.
* **Tested** says nothing about inputs that were not generated.
* **Not proved** does not mean the function or the spec is wrong.

Other limits:

* The subset is narrow (section 3); real library code, as sampled, is outside it.
* Fewer than half of the in-subset functions get a proof of the original at the shipped defaults (section 5), and a
  failing proof costs about 12 minutes.
* Speedups hold for the declared distribution, this machine and this Node version only.
* Proofs written against the earlier `Faithful.Tactics` can stop compiling under `Faithful.Simp` (1 of 20 re-checked
  did; docs/PROOFS.md "Limits"), so `faithful verify` on an older delivery can fail.
* SMT tier wiring and documentation gaps as in section 9.

## 15. Reproducing

```
pnpm install && pnpm build
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js setup                  # states the cost first

# corpus coverage
node --experimental-strip-types packages/engine/scripts/corpus-report.ts --differential
# original proofs (defaults = final configuration), and their summary
node scripts/measure.mjs --corpus --no-optimize --concurrency 3 --out <dir> --only <ids>
node scripts/proof-summary.mjs <dir> [--only ids] [--within 6,6]
# candidate proofs
node scripts/candidate-proof-summary.mjs <dir>
# the whole workflow under the autopilot
node scripts/measure.mjs --corpus --out docs/measurements/<date>-campaign
node scripts/measure.mjs --dir packages/translate/library-sample --out docs/measurements/<date>-library-sample
# regenerate the tables in this file
node scripts/launch-tables.mjs --write
# showcase and media
pnpm --filter @faithful/showcase build
node apps/showcase/scripts/check.mjs
node scripts/make-media.mjs apps/showcase/public/recordings/<recording>.json
```

## 16. Tables (generated)

<!-- TABLES:START -->
_Generated by `node scripts/launch-tables.mjs --write` on 2026-10-05T22:17:31.937Z; do not edit by hand._

### Measurements

Campaign: `docs/measurements/2026-10-05-campaign/results.jsonl`, 74 of 74 functions (corpus size from `packages/translate/corpus`, the walk `scripts/measure.mjs --corpus` uses).

| field | value |
|---|---|
| date | 2026-10-05 (campaign stamps) |
| model | `gpt-6-luna` (campaign stamps) |
| toolchain | Codex CLI codex-cli 0.159.2, Lean leanprover/lean4:v4.34.0, Mathlib `5ed2965256430c3649e86755f9576b54eca72435`, Z3 5.2.0 (wasm), Node v25.8.1, darwin-arm64 |
| toolchain source | the `toolchain` field of 39 campaign session.json file(s) |

#### Subset coverage

Source: `docs/measurements/2026-10-05-proofs-low/results.jsonl`, every corpus function (74); the translator is deterministic, so this is the corpus's coverage.

| class | functions | in subset | refused |
|---|---|---|---|
| numeric | 14 | 10 | 4 |
| array | 16 | 13 | 3 |
| string | 12 | 10 | 2 |
| recursive | 10 | 5 | 5 |
| refuse | 22 | 1 | 21 |
| **total** | 74 | 39 | 35 |

Cross-check against the campaign: 74 campaign function(s) also in this run, 0 with a different subset verdict or refusal code.

Refusals by code, corpus (35 refused of 74; source as above):

| refusal code | functions |
|---|---|
| no-termination-measure | 10 |
| float | 5 |
| unsupported-syntax | 3 |
| map-set | 2 |
| mutable-capture | 2 |
| regex | 2 |
| async | 1 |
| bitwise | 1 |
| date | 1 |
| dictionary | 1 |
| generic | 1 |
| io | 1 |
| missing-annotation | 1 |
| nan | 1 |
| random | 1 |
| this | 1 |
| unsupported-library | 1 |

Refusals by code, library sample (source: `docs/measurements/2026-10-05-library-sample/results.jsonl`, 20 functions from es-toolkit, radash and remeda, 0 in subset):

| refusal code | functions |
|---|---|
| unsupported-syntax | 13 |
| &nbsp;&nbsp;of which: overloaded function | 7 |
| &nbsp;&nbsp;of which: top-level statement (import / module-load code) | 5 |
| &nbsp;&nbsp;of which: missing module constant (does not type-check alone) | 1 |
| generic | 5 |
| missing-annotation | 1 |
| unsupported-type | 1 |

#### Disagreements and rulings

Source: `docs/measurements/2026-10-05-campaign/results.jsonl`, campaign functions in the subset (39 so far). Rulings are made by the autopilot user policy (`packages/cli/src/flow/autopilot.ts`).

| measure | count |
|---|---|
| functions with at least one spec proposal | 39 |
| spec proposals (all, incl. revisions) | 63 |
| functions where the challenge search found a disagreement | 6 |
| functions with at least one ruling | 6 |
| rulings: function wrong, then carve-out | 16 |
| rulings: spec wrong (revise) | 12 |
| blocked at agreement | 4 |
| agreed on a spec | 35 |

#### Proving the original function

Baseline, effort `low`, 6 attempts / 6 minutes. Source: `docs/measurements/2026-10-05-proofs-low/results.jsonl`, all in-subset corpus functions (39).

| class | proved of in subset | blocked at agreement | proof attempted | median attempts (proved) | median minutes (proved) |
|---|---|---|---|---|---|
| numeric | 1 of 10 | 0 | 10 | 1 | 0.2 |
| array | 2 of 13 | 1 | 12 | 3.5 | 0.7 |
| string | 0 of 10 | 3 | 7 | - | - |
| recursive | 0 of 5 | 0 | 5 | - | - |
| refuse | 0 of 1 | 0 | 1 | - | - |
| **total** | 3 of 39 | 4 | 35 | 1 | 0.2 |

Held-out, before: the same baseline run restricted to the 26 held-out ids (the ids in `docs/measurements/2026-10-05-proofs-final-heldout/results.jsonl`; the split rule in docs/PROOFS.md: in-subset ids sorted, 0-based index i with i mod 3 != 1).

| class | proved of in subset | blocked at agreement | proof attempted | median attempts (proved) | median minutes (proved) |
|---|---|---|---|---|---|
| numeric | 0 of 6 | 0 | 6 | - | - |
| array | 1 of 9 | 1 | 8 | 6 | 1.3 |
| string | 0 of 7 | 3 | 4 | - | - |
| recursive | 0 of 4 | 0 | 4 | - | - |
| **total** | 1 of 26 | 4 | 22 | 6 | 1.3 |

Held-out, after: shipped defaults (effort `high`, guide, `Faithful.Simp`, 10 attempts / 12 minutes). Source: `docs/measurements/2026-10-05-proofs-final-heldout/results.jsonl` (26 functions).

| class | proved of in subset | blocked at agreement | proof attempted | median attempts (proved) | median minutes (proved) |
|---|---|---|---|---|---|
| numeric | 3 of 6 | 0 | 6 | 1 | 1.1 |
| array | 4 of 9 | 1 | 8 | 3 | 2.1 |
| string | 2 of 7 | 3 | 4 | 9 | 8.3 |
| recursive | 3 of 4 | 0 | 4 | 5 | 5.0 |
| **total** | 12 of 26 | 4 | 22 | 5 | 4.4 |

Campaign (shipped defaults). Source: `docs/measurements/2026-10-05-campaign/results.jsonl`, campaign functions in the subset (39 so far).

| class | proved of in subset | blocked at agreement | proof attempted | median attempts (proved) | median minutes (proved) |
|---|---|---|---|---|---|
| numeric | 7 of 10 | 0 | 10 | 5 | 6.0 |
| array | 7 of 13 | 1 | 12 | 2 | 1.8 |
| string | 3 of 10 | 3 | 7 | 6 | 5.5 |
| recursive | 2 of 5 | 0 | 5 | 4.5 | 3.9 |
| refuse | 1 of 1 | 0 | 1 | 1 | 1.2 |
| **total** | 20 of 39 | 4 | 35 | 5 | 4.6 |

Proving optimization candidates: one row per candidate-proof run. Source: `docs/measurements/2026-10-05-cproofs-<run>/results.jsonl` and its `config.json`; candidates from `docs/measurements/2026-10-05-candidates` (split.json: 17 TUNE candidates over 8 functions, 33 held-out candidates over 16 functions).

| run | config | proved of attempted | attempted candidates | proved, by tier | median attempts (proved) | median minutes (proved) | errors |
|---|---|---|---|---|---|---|---|
| `tune-a-split` | lib v1, split, guide off, effort high, 8 att / 12 min | 1 of 17 | 17 TUNE, 0 held-out | proved 1 | 5 | 3.1 | 0 |
| `tune-abce` | lib current, split, guide on, effort high, 8 att / 12 min | 2 of 17 | 17 TUNE, 0 held-out | proved 2 | 5.5 | 6.5 | 0 |
| `tune-base` | lib v1, single, guide off, effort high, 8 att / 12 min | 1 of 17 | 17 TUNE, 0 held-out | proved 1 | 4 | 3.3 | 0 |
| `tune-final-default (final config)` | lib current, split, guide on, effort high, 8 att / 12 min | 1 of 17 | 17 TUNE, 0 held-out | proved 1 | 3 | 1.9 | 0 |

#### Optimization candidates

Source: `docs/measurements/2026-10-05-campaign/results.jsonl`, every candidate of every campaign function (130 candidates from 34 function(s) that reached optimization).

| outcome | candidates |
|---|---|
| faster, not proved | 72 of 130 |
| not faster | 46 of 130 |
| rejected | 9 of 130 |
| incumbent (accepted, best so far) | 3 of 130 |

Faster, not proved (sum of `fasterNotProved`): 72 of 130 candidates, in 28 function(s).

| rejection stage | candidates |
|---|---|
| proof | 72 of 130 |
| benchmark | 46 of 130 |
| differential | 5 of 130 |
| compile | 3 of 130 |
| smt | 1 of 130 |

#### Speedups

Source: `docs/measurements/2026-10-05-campaign/results.jsonl`, `bestSpeedup` (the accepted candidate against the original, 95% CI) of the 3 campaign functions that have one. Ratios: estimate and lower bound rounded down, upper bound rounded up.

|  | speedup | 95% CI | function | tier | measured on |
|---|---|---|---|---|---|
| best | 1.6x | 1.6-1.8 | numeric/sign | proved | auto: x: integer in [0, n] |
| median | 1.08x | 1.04-1.10 | array/sortPointsByY | proved | auto: points: array of n values |
| worst | 1.05x | 1.03-1.08 | numeric/factorial | proved | auto: n: integer in [0, n] |

#### Best result per function

Source: `docs/measurements/2026-10-05-campaign/results.jsonl`, `bestTier` of every campaign function (74). `refused`: outside the subset; `blocked`: no agreed spec; `none`: nothing reached a tier.

| best tier | functions |
|---|---|
| refused | 35 of 74 |
| proved | 20 of 74 |
| none | 15 of 74 |
| blocked | 4 of 74 |

#### Session cost

Source: `docs/measurements/2026-10-05-campaign/results.jsonl`, campaign functions that ran a session (Codex calls or wall time above zero; 39 of 74).

| measure | median | min | max | total |
|---|---|---|---|---|
| session wall time (minutes) | 13.1 | 0.9 | 31.7 | 516.2 |
| Codex calls | 18 | 3 | 31 | 682 |
| Codex calls that failed |  |  |  | 10 |
| input tokens (incl. cached) |  |  |  | 18139076 |
| output tokens |  |  |  | 1231531 |

#### Errors

Source: `docs/measurements/2026-10-05-campaign/results.jsonl`, campaign functions whose result has an `error` (74 results read).

1 of 74: recursive/powerBySquaring.
<!-- TABLES:END -->


## Campaign caveats (read with the tables above)

* **What ran.** `scripts/measure.mjs --corpus --concurrency 3 --minutes 8 --proof-attempts 10 --proof-minutes 12` on 2026-10-05, after the code and the Lean library were frozen (an earlier run of the same campaign was discarded because the Lean library changed while it was running; its partial files are not part of any number here). The user's decisions were made by the autopilot policy recorded in each result (throw as a precondition; up to 2 "the spec is wrong" revisions, then the first carve-out class; Agree when no disagreement remains; faster-but-not-proved candidates never accepted).
* **The machine was shared.** Three campaign sessions ran at once, and for part of the time two real showcase recordings and, earlier, a tuning agent ran alongside them. Benchmarks were therefore measured on a loaded machine. The intervals are real bootstrap intervals over those measurements, so noise shows up as width, but a "faster" verdict here may not reproduce on an idle machine, and small speedups (1.05×–1.1×) in particular should be re-measured before being relied on.
* **Candidates mostly stop short of Proved.** Of the candidates the model proposed, most that were significantly faster could not be proved: either the candidate is outside the verifiable subset (it uses `Math.sqrt`, non-integer division, data-dependent loop bounds, `push`, `Set`), or Lean did not accept a proof within the budget (the range obligation is the usual blocker, see PROOFS.md "Candidate proofs"). The tool reports these as "faster, not proved" and never promotes them. Candidate-proof tuning on the TUNE split (17 candidates) proved 1 or 2 per configuration, which is inside the run-to-run noise of about ±2; the HELD-OUT run was not performed because the TUNE result met the written stop rule. Lever E (length facts) is proposed in PROOFS.md and NOT adopted: it changes the Lean statement and needs an explicit decision.
* **One error row.** `recursive/powerBySquaring`: the optimizer's baseline benchmark faulted on a generated input outside what the original can run quickly; the original was proved but no candidate could be benchmarked. This is a known optimizer limitation (benchmark inputs are drawn from the declared distribution without an input screen), recorded, not fixed.
* **Speedups are on declared, auto-calibrated distributions** (each row names its distribution); they are not general performance claims. The speedups of proved incumbents are small (best 1.6×) because the model's large wins (e.g. 26× for an aliquot sum, 60,000× for iterative Fibonacci) used constructs the translator refuses or produced loops whose range obligation Lean did not close.
* **Showcase opener.** The showcase now opens on a landing page whose default recording is `clamp` (the real Z3 catch). `aliquotSum` stays in the menu with a caution: it was recorded before the spec-fault fix (docs/LAUNCH-NOTES.md), shows Lean evaluation faults as disagreements and two carve-outs made because of them. It was previously the default recording (`aliquotSum-r3` in `docs/measurements/showcase-select2/`, shipped as `apps/showcase/public/recordings/aliquotSum.json`): two candidates about 27× faster that the tool declines to prove (outside the verifiable subset, so they stay at Tested), then a third that Z3 verifies to k=6 and Lean proves against the agreed spec, but only for n < 0: the two carve-outs exclude n = 0 and every positive n, so the proof covers negative n (where the original returns 0) and nothing else. Its 1.92× (95% CI 1.92–1.94) was measured on `auto: n: integer in [0, n]` at n = 1024, 2048, 4096, entirely outside what the proof covers. This is a deviation from the target story ("first candidate rejected by the proof or SMT tier for a real reason, second proved and measurably faster"): the first two candidates are not rejected for being wrong, they are not provable. The selection ran 15 real sessions (fibRecursive ×8 incl. `fibonacci`, aliquotSum ×3, spread ×4) and none showed a wrong candidate caught and then a proved faster one in the same session.
* **A real Z3 catch exists, in a different session.** In the campaign, `numeric/clamp` candidate 2 was rejected by Z3, which found the input `[-2,-1,-3]` where it differs from the original; the session ends with the original (candidate 1 was verified but not significantly faster). It is shipped as the `clamp` recording, the unmodified campaign event log. `fibRecursive` (`fibRecursive-r5`) is shipped as a third recording: the iterative candidate's equality with the spec was proved, the range part was not, so it stays "faster, verified to k, not proved".
* **Raw session logs are not in git** (734 MB); results, splits, rules and notes are. `docs/measurements/**/sessions/` holds them locally.
