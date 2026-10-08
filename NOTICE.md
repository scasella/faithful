# Attribution

Faithful is a new codebase. Pieces listed here were adapted, with changes, from
[scasella/undefined](https://github.com/scasella/undefined) (MIT, © 2026 Stephen Casella):

| Faithful file | Adapted from (scasella/undefined @ `e305e00`) | What was reused |
|---|---|---|
| `packages/engine/src/sandbox/mask.ts` | `packages/engine/src/sandbox/mask.ts` | Purity masking: shadow ambient globals with traps, intrinsic-integrity snapshot and restore |
| `packages/engine/src/mutation/mutate.ts` | `packages/engine/src/mutation/mutate.ts` | Mutant enumeration, seeded round-robin selection over kinds, stillborn accounting |
| `packages/engine/src/mutation/check.ts` | `packages/engine/src/mutation/run.ts`, `packages/engine/src/mutation/classify.ts` | Mutant-run and bucket-invariant structure (outcomes renamed) |
| `packages/engine/src/gates/compile.ts` | `packages/engine/src/gates/compile.ts` | The idea of a lazily built, cached compiler state (the implementation is new) |
| `packages/engine/src/sandbox/source.ts` | `packages/engine/src/gates/compile.ts` | `moduleProblems` (module-syntax rejection), extended |
| `packages/engine/src/benchmark/rng.ts` | `packages/engine/src/mutation/mutate.ts` | `prng` (mulberry32) and `shuffle` (Fisher-Yates), renamed and typed as `Rng` |
| `packages/prover/src/codex.ts` | `apps/site/server/codexService.ts` | One-`codex exec`-subprocess-per-request driver: argument shape, auth-failure patterns, serial queue |

Everything else is written for this one workflow.

## Library sample

`packages/translate/library-sample/` contains 20 functions copied verbatim (with the type declarations they need) from the
libraries below, for the library measurement reported in docs/LAUNCH.md. Each file names its source path and commit; full license texts are in
`packages/translate/library-sample/LICENSES/`.

| Library | Repository | Commit | License | Copyright holder |
|---|---|---|---|---|
| es-toolkit | https://github.com/toss/es-toolkit | `43e1118884e07cebdf1e767038f6e7f697fa27ec` | MIT | Copyright (c) 2024 Viva Republica, Inc. |
| radash | https://github.com/rayepps/radash | `4cab1900d08e0997abc4f17aec3cbfe18958d766` | MIT | Copyright (c) 2022 radash |
| remeda | https://github.com/remeda/remeda | `8e6e78f6eaf66eaf0b4797d72cc3691823c91335` | MIT | Copyright (c) 2018 remeda |

## Showcase service worker

`apps/showcase/public/coi-serviceworker.js` is coi-serviceworker 0.1.7 (https://github.com/gzuidhof/coi-serviceworker), MIT, © 2021 Guido Zuidhof; license text in `apps/showcase/public/coi-serviceworker.LICENSE.txt`. It adds the cross-origin-isolation headers that Z3's WASM build needs on static hosting.

## Third-party software used or shipped

Not vendored in this repository: the Codex CLI, Lean 4 and Mathlib are installed separately and used through their command lines. `lean/lake-manifest.json` pins Mathlib; nothing from it is copied here.

Shipped inside the static showcase build (`apps/showcase`):

| Component | Version | License | Copyright holder | Where |
|---|---|---|---|---|
| Z3 (via `z3-solver`, WASM build) | 5.2.0 | MIT | Microsoft Corporation | `dist/z3/`, with its `LICENSE.txt` |
| TypeScript compiler and `lib.*.d.ts` | 5.9.3 | Apache-2.0 | Microsoft Corporation | bundled; the lib texts carry their license header |
| Preact | 10.29.8 | MIT | Jason Miller | bundled |
| @preact/signals | 2.11.3 | MIT | Preact Team | bundled |
