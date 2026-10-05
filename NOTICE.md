# Attribution

Faithful is a new codebase. Pieces listed here were adapted, with changes, from
[scasella/undefined](https://github.com/scasella/undefined) (MIT, © 2026 Stephen Casella):

| Faithful file | Adapted from | What was reused |
|---|---|---|
| `packages/engine/src/sandbox/mask.ts` | `src/sandbox/mask.ts` | Purity masking: shadow ambient globals with traps, intrinsic-integrity snapshot and restore |
| `packages/prover/src/codex.ts` | `server/codexService.ts` | One-`codex exec`-subprocess-per-request driver, serialized, argument shape |

Everything else is written for this one workflow.

## Library sample

`packages/translate/library-sample/` contains 20 functions copied verbatim (with the type declarations they need) from the
libraries below, for the Phase 9 measurement. Each file names its source path and commit; full license texts are in
`packages/translate/library-sample/LICENSES/`.

| Library | Repository | Commit | License | Copyright holder |
|---|---|---|---|---|
| es-toolkit | https://github.com/toss/es-toolkit | `43e1118884e07cebdf1e767038f6e7f697fa27ec` | MIT | Copyright (c) 2024 Viva Republica, Inc. |
| radash | https://github.com/rayepps/radash | `4cab1900d08e0997abc4f17aec3cbfe18958d766` | MIT | Copyright (c) 2022 radash |
| remeda | https://github.com/remeda/remeda | `8e6e78f6eaf66eaf0b4797d72cc3691823c91335` | MIT | Copyright (c) 2018 remeda |

## Showcase service worker

`apps/showcase/public/coi-serviceworker.js` is coi-serviceworker 0.1.7 (https://github.com/gzuidhof/coi-serviceworker), MIT, © 2021 Guido Zuidhof; license text in `apps/showcase/public/coi-serviceworker.LICENSE.txt`. It adds the cross-origin-isolation headers that Z3's WASM build needs on static hosting.
