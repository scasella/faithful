# Contributing

Faithful is a pnpm TypeScript monorepo plus a Lean 4 project (`lean/`). Read [docs/DESIGN.md](docs/DESIGN.md) first: it is
the contract every package is built against, and its "Non-negotiables" section is the list of rules below in full.

## Prerequisites

* Node 22.12 or later (`engines` in `package.json`; CI uses Node 22).
* pnpm 10.11.1 (`packageManager` in `package.json`).
* To run the whole workflow or the Lean tests: the Codex CLI (model calls only) and the Lean toolchain with the Mathlib
  cache from `node packages/cli/dist/bin.js setup --yes` (about 12 GB of free disk; `faithful doctor` checks).

## Build and test

```
pnpm install
pnpm build                                 # tsc -b, then the two app builds
pnpm test                                  # the whole suite
FAITHFUL_FAST=1 FAITHFUL_SKIP_LEAN=1 pnpm test   # the fast tier, without Lean: the CI job "node"
FAITHFUL_FAST=1 pnpm test                  # the fast tier with Lean: the CI job "lean"
```

`pnpm test` is vitest over `packages/*/src/**/*.test.ts` and `apps/*/src/**/*.test.ts`. There are two tiers.

* **Heavy suites.** Twelve files (`HEAVY_SUITES` in `vitest.config.ts`: the engine's red-team and corpus suites, the SMT
  red-team, sanity and library suites, the candidate-proof flow test, and the benchmark test, which measures wall-clock time
  and needs a quiet machine) mostly evaluate hundreds of generated programs in the sandbox, Lean or Z3. On an Apple M4 Pro with 14 cores (Node v22.23.3, Lean 4.34.0, 2026-10-09) the whole suite, 76 files and
  3,807 tests, passes in 473 seconds, and these files are most of the test time. `FAITHFUL_FAST=1` leaves them out. CI does
  that, because on a shared hosted runner their Z3 queries exceed the fixed 120 s budgets the tests set, and timing tests are
  not reliable there; so CI passing does not cover them. Run the whole suite on your machine before you change the translator, the SMT encoding, the sandbox or
  the Lean library. The "heavy" workflow runs them on GitHub by hand; it has not been shown to pass on a hosted runner.
* **Lean-gated tests.** Tests that need Lean are written with `describe.skipIf(!hasLean)`, and `hasLean` is false when
  `FAITHFUL_SKIP_LEAN` is set or no Lean project is found (`git grep -n hasLean` lists them: the translator's Lean runtime
  checks, the corpus and red-team suites that evaluate the model in Lean, the prover's proof-checking tests, the SMT sanity
  mode, the flow tests). With `FAITHFUL_SKIP_LEAN=1` those are skipped, not passed. Run them without the variable, after
  `setup --yes`, before you change the translator, the prover, the Lean library or the SMT encoding. Real Codex runs are
  slow and are not part of the tests.

CI runs the fast tier on Node 22, the oldest line `engines` allows, and the sandbox's start-up is sensitive to the Node
version: Node 22 loads its bundled undici lazily, and undici compiles WebAssembly, which the sandbox worker removes from
its global scope (`hardenRealm` in `packages/engine/src/sandbox/mask.ts`). A change to the worker's start-up or to the
masked globals should be run under Node 22 as well as your own version (`nvm use 22`, then the engine tests).

The screenshot and media scripts (`apps/ui/scripts/*.mjs`, `apps/showcase/scripts/check.mjs`, `scripts/make-media.mjs`)
drive headless Chrome, which they look for at the macOS application path; set `CHROME=/path/to/chrome` elsewhere.
`make-media.mjs` also needs ffmpeg.

## Layout

The package list is in the [README](README.md#packages); the dependency direction is in docs/DESIGN.md. In short:
`core` (labels, stamp, runner, `.faithful` store) is under everything; `translate` (TypeScript subset to Lean) has no
dependency on the others; `engine`, `smt` and `prover` check candidates; `session` holds the event-sourced state; `cli`
wires them and serves `apps/ui`; `apps/showcase` is the static replay site; `lean/` is the Lake project. The translator's
decisions and known gaps are in `packages/translate/NOTES.md` and docs/TRANSLATOR.md.

## Rules that stay fixed

* The five labels ("Proved", "Proved (trusting the compiler)", "Verified to k", "Tested", "Not proved") and the sentence
  that must accompany "Proved" live in `packages/core/src/tiers.ts`. Use them from there; do not reword them or add a
  sixth. A failed proof is a failed proof.
* No scores, grades or percentages in anything a user sees. The only percent sign allowed in user-facing text is the one in
  "95% CI".
* Speedups are never rounded up: estimates and lower bounds round down, upper bounds up, and "faster" is said only when
  the interval, as printed, lies above 1 (`apps/ui/src/lib/format.ts`, `packages/engine/src/evidence/evidence.ts`).
* The translator (`packages/translate`) is deterministic code. There is no model call in it, and the model never
  translates TypeScript or edits the Lean model.
* Do not widen the translator's subset to improve numbers. Refusals are findings. A change to the subset needs corpus
  entries (`packages/translate/corpus`) and red-team probes that show it is sound, and a note in docs/TRANSLATOR.md.
* Never weaken a test, an assertion or a checker to make something pass. Fix the cause or report the failure.
* Faithful never modifies the user's source files. Delivery is a patch under `.faithful/<fn>/`.
* Nothing leaves the machine except prompts to Codex, shown verbatim in the UI. Codex runs read-only in an empty
  temporary directory and is never given the repository ([docs/SECURITY.md](docs/SECURITY.md)).
* Every measured number carries a date, a model id and the toolchain versions (`Stamp` in `packages/core`). Do not state
  a measurement you did not take, and do not change a recorded one: results live under `docs/measurements/` and the
  recordings under `apps/showcase/public/recordings/`.

## Pull requests

Keep a change small and say what you ran: `pnpm build` and the tests, with or without `FAITHFUL_SKIP_LEAN`. If a change
affects wording that users see, say which label or claim it touches.
