# Candidate-proof dataset: rules written before any candidate was collected or any proof run

Written 2026-10-05, before `scripts/collect-candidates.mjs` was first run and before any candidate proof harness run.

## Population and spec
* Population: every corpus function that is in the verifiable subset AND reached an agreed spec in at least one session of
  `docs/measurements/2026-10-05-proofs-*/` (35 functions; the four functions blocked at agreement in every run,
  array/sumOddSquares, string/caesarShift, string/ellipsize, string/repeatString, have no agreed spec and are excluded).
* Spec and original proof: the session is chosen by this fixed preference order of runs, first among sessions in which the
  ORIGINAL was proved, otherwise among sessions with an agreed spec:
  final-heldout, tune-b-10x12, tune-d-simp, tune-d-simp-r2, tune-f-spechint, tune-c-guide, tune-d-simp-noguide, tune-a-high,
  tune-a-high-r2, tune-a-medium, tune-a-esc, tune-base-r2, low.
  The session's events up to (excluding) its first `optimize.started` / `deliver.done` are replayed (`SessionRuntime.resume`),
  so agreement, carve-outs, throw choice and the original's accepted proof (if any) are exactly that session's.

## Collection
* The real optimizer (`Optimizer`, candidate effort as in production) runs on the resumed session with the proof stage
  disabled (`skipProof`), at most 6 rounds / 10 minutes per function, Codex concurrency 3.
* A candidate enters the dataset iff it passed compile, purity, differential, and SMT (`smt` stage `pass`, i.e. Verified
  to k), and the translator gives it a Lean model with the same record types (exactly the candidates that reach the
  proof loop with a Verified-to-k tier). Duplicates (normalized source) within a function are dropped by the optimizer.
  Candidates whose SMT stage was skipped/unsupported/timeout are recorded in `excluded.jsonl` with the reason, not used.
* Speed is irrelevant to proof difficulty: faster and not-faster candidates are both kept (the speedup is recorded).

## Split (by FUNCTION, so that candidates sharing a spec and an original never straddle the split)
* Order the functions that contributed >= 1 candidate by id (`class/fn`) lexicographically; 0-based index i.
* TUNE = i mod 3 == 1; HELD-OUT = the rest.
* Levers are chosen on TUNE only. HELD-OUT diagnostics are not read until after the single final evaluation run.
* Note: the brief's examples (iterative fibonacci vs naive recursion; `spread`) and the candidate proof attempts in
  `docs/measurements/showcase-select/` (numeric/fibonacci, numeric/fibRecursive, array/spread, numeric/aliquotSum) were
  read before this split was written; if those functions land in HELD-OUT this is stated in docs/PROOFS.md.
