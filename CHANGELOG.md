# Changelog

All notable changes are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 - 2026-10-08

First public release.

### Added

* `faithful`, with the commands `optimize`, `verify`, `doctor`, `setup` and `showcase-record`, and a browser UI served
  on 127.0.0.1 (Select, Translate, Agree, Prove original, Optimize, Deliver). `faithful optimize` runs the same workflow
  headlessly. Delivery is a patch, a provenance file and `VERIFY.md` under `.faithful/<fn>/`; the user's source files
  are never modified, and `faithful verify` re-checks a delivery without trusting it.
* A deterministic translator (no model call) from TypeScript subset v1 to a Lean 4 model, with a refusal code and a line
  number for everything outside the subset (docs/TRANSLATOR.md).
* The agreement step: the model proposes a spec, a challenge run looks for inputs where spec and code disagree, and the
  user rules on each disagreement.
* The candidate funnel: compile, purity, differential test, bounded Z3 check ("Verified to k"), benchmark with 95% CI,
  and a Lean proof against the agreed spec.
* Five result labels, each with its definition in docs/TIERS.md: Proved, Proved (trusting the compiler), Verified to k,
  Tested, Not proved. "Proved" always carries its sentence.
* The Tested-only path for functions the translator refuses (`optimize --tested`, `--specials`): differential testing
  plus a mutation check, with no spec, proof or SMT claim.
* A static showcase that replays recorded sessions and re-runs the funnel in the browser, with Z3 as WASM where the
  page is cross-origin isolated.
* `examples/demo`, five small functions to try the tool on, and the documents under `docs/`, including the threat model
  (docs/SECURITY.md).

### Measured at release

Date 2026-10-05, model `gpt-6-luna` through Codex CLI 0.159.2, Node v25.8.1, Lean 4.34.0, Mathlib
`5ed2965256430c3649e86755f9576b54eca72435`, Z3 5.2.0, macOS arm64. Numbers are copied from docs/LAUNCH.md, which holds
the method, the tables and their results files under `docs/measurements/`.

* Subset coverage: 39 of the 74 corpus functions are in the subset; 0 of the 20 library-sample functions are.
* Proofs of the original, baseline (effort `low`, 6 attempts / 6 minutes): 3 of the 39 in-subset functions proved.
* Proofs of the original, held-out 26 in-subset functions, shipped defaults (effort `high`, prompt guide,
  `Faithful.Simp`, 10 attempts / 12 minutes): 1 of 26 at baseline, 12 of 26 with the defaults.
* Optimization campaign over the 74 corpus functions: 130 candidates from the 34 functions that reached optimization;
  72 were faster but not proved, 46 not faster, 9 rejected, 3 accepted as incumbent.
* Speedups of the 3 campaign functions with an accepted candidate, each on its declared distribution: best 1.6x
  (95% CI 1.6-1.8, numeric/sign), median 1.08x (95% CI 1.04-1.10, array/sortPointsByY), worst 1.05x (95% CI 1.03-1.08,
  numeric/factorial).
* Z3 caught a real difference in the campaign: for `numeric/clamp`, candidate 2 was rejected because Z3 found the input
  [-2,-1,-3], on which the original throws and the rewrite returns -1. It is the default showcase recording.

### Known limits

From docs/LAUNCH.md, section 14 and "Campaign caveats". What each label does not mean is in docs/TIERS.md.

* **Proved** is about the Lean model and the agreed spec under the stated preconditions (integers within ±2^53, BMP
  strings, in-range indices, carve-outs, ...). It is not a statement about the TypeScript on every input, it does not
  mean the spec is what you wanted, and it says nothing about speed.
* **Proved (trusting the compiler)** is weaker than Proved: a bug in Lean's compiler or runtime could make it false.
* **Verified to k** says nothing outside its bounds and nothing about the spec; it is not a proof.
* **Tested** says nothing about inputs that were not generated.
* **Not proved** does not mean the function or the spec is wrong.
* The subset is narrow; real library code, as sampled, is outside it.
* A failing proof costs about 12 minutes at the shipped defaults, and not every in-subset function gets a proof of the
  original (12 of the 26 held-out functions did).
* Speedups hold for the declared distribution, this machine and this Node version only.
* Proofs written against the earlier `Faithful.Tactics` can stop compiling under `Faithful.Simp` (1 of 20 re-checked
  did; docs/PROOFS.md "Limits"), so `faithful verify` on an older delivery can fail.
* The campaign machine was shared: three sessions ran at once, and for part of the time showcase recordings and a
  tuning run ran alongside them. Benchmarks were measured on a loaded machine, so a "faster" verdict may not reproduce
  on an idle one, and small speedups (1.05×–1.1×) in particular should be re-measured before being relied on.
* Most candidates that were significantly faster could not be proved: either the candidate is outside the verifiable
  subset, or Lean did not accept a proof within the budget (the range obligation is the usual blocker). The tool reports
  these as "faster, not proved" and never promotes them. Candidate-proof tuning proved 1 or 2 of 17 candidates per
  configuration, which is inside the run-to-run noise of about ±2; no held-out run was performed.
* The measurements used a scripted user policy (the autopilot); a real user who rules differently gets different specs
  and different proof difficulty.
* One campaign function, `recursive/powerBySquaring`, ended in an error: the optimizer's baseline benchmark faulted on a
  generated input outside what the original can run quickly. Known, recorded, not fixed.
* Z3 in the browser needs cross-origin isolation; it was tested in headless Chrome 154 only, not in Firefox or Safari.
* The execution sandbox catches accidents and is not a security boundary: model-written code runs on your machine with
  your user's rights (docs/SECURITY.md).
* Red-teaming of the translator stopped after round 4 by decision, not because it ran dry.
