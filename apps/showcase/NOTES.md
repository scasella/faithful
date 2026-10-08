# Showcase: implementation notes

Newest at the bottom of each section.

## Findings from orientation (2026-10-05)

- Node-only spots that block the browser:
  - translate/src/program.ts: node:fs, node:path, node:module (lib d.ts reading); translate.ts: node:crypto createHash.
  - engine/src/gates/compile.ts: ts.createCompilerHost → needs ts.sys. TypeScript 5.9.3 exports `ts.setSys`, so a virtual
    sys (lib d.ts text bundled) avoids a package edit.
  - engine/src/sandbox/sandbox.ts + worker.ts: node:worker_threads. worker.ts only uses parentPort/workerData.
  - smt/src/z3.ts: node worker + createRequire. equivalence.ts imports Z3Driver as a type only.
- z3-solver 5.2.0 build is an emscripten pthreads build (z3-built.js 354 KB, z3-built.wasm 34.9 MB); eval_smtlib2_string runs
  through async_call on a pthread → needs SharedArrayBuffer → cross-origin isolation.

## Plan

- Vite aliases: @faithful/* → package src; node:* → showcase shims (fs reads a virtual lib map, crypto = sync sha256).
- Plugin redirect: engine sandbox/sandbox.ts → showcase BrowserSandbox (same API); worker uses engine worker.ts unchanged
  with a node:worker_threads shim (parentPort = self).
- Z3: dedicated classic Web Worker importScripts(z3-built.js); terminate on timeout. COI via vendored coi-serviceworker if needed.

## Z3-in-browser spike (2026-10-05, headless Chrome 154.0.8037.95 via playwright-core 1.63.0, python3 -m http.server)

- coi-serviceworker 0.1.7 (npm), MIT, (c) 2021 Guido Zuidhof; sha256 of coi-serviceworker.js
  d12bd536e27e39a773d7dc7adb1a1167d24002293e97ac81c995fb00cf8d4d5a.
- WITH coi-serviceworker: first visit registers the SW and reloads once (isolated after 163 ms); in a classic Worker,
  fetch + indirect-eval z3-built.js, `init(initZ3, {locateFile, mainScriptUrlOrBlob})` from low-level wrapper: init 79 ms
  total, first query (sat with model) 68 ms, second (unsat) 26 ms. WORKS.
- WITHOUT COI: init succeeds, but the first eval_smtlib2_string throws `std::system_error` after
  "pthread_create: environment does not support SharedArrayBuffer, pthreads are not available". DOES NOT WORK.
- Verdict: z3-solver 5.2.0 in the browser works ONLY with cross-origin isolation. Only Chrome could be tested here
  (no Firefox/WebKit builds in ~/Library/Caches/ms-playwright).

## Built (2026-10-05, first working version)

- Live funnel works in the built site from `python3 -m http.server`: translate (hash equals recorded), compile, purity,
  differential, SMT (Z3 5.2.0 WASM, ~60 ms WASM start + ~50 ms solve per query on clamp). scripts/check.mjs passes with and
  without COI (without: SMT shown "not available here").
- No package source was modified: node built-ins are shimmed (src/shims), ts.setSys gives the compile gate a virtual
  sys, the engine's Node sandbox host is redirected to src/live/browserSandbox.ts; engine worker.ts runs unchanged in a
  Web Worker.
- Lean sidecar convention: public/recordings/<name>.lean next to <name>.json.

## Build and check (2026-10-05)

- Commands: `pnpm run build` (tsc --noEmit + vite build) or `pnpm exec vite build`; `node scripts/check.mjs [--no-coi]`
  (serves dist/ with python3 -m http.server, drives installed Chrome headless); `pnpm exec vitest run apps/showcase`
  from the repo root (sha256 shim vs node:crypto, dev-sample equals the real events.jsonl, recording validation).
- check.mjs passes on the built site with COI (all four live stages incl. Z3) and with service workers blocked (SMT
  "not available here"), and against `vite` dev.
- Bundle: index 166 kB (55 kB gz), live chunk (TypeScript + translator + engine + SMT encoder + lib d.ts) 4.31 MB
  (1.14 MB gz, loaded on first "Run"), sandbox worker 11 kB, z3 worker 60 kB, z3-built.wasm 34.9 MB + z3-built.js 354 kB
  (static, loaded per SMT query, cached). dist total 39 MB.
- Measured (headless Chrome 154, this Mac): per Z3 query WASM start ~55-80 ms, total ~105-165 ms; clamp correct
  candidate: 4 queries, SMT stage ~0.5 s, whole live funnel ~0.6-0.9 s; wrong candidate rejected at differential in ~0.25-0.45 s.
- Open: Firefox/Safari untested; Web Worker heap is not capped; first-visit SW reload.

## After review (2026-10-05)

- Endless-loop candidates: purity sample bounded (totalMs 8 s); a sample call that does not finish in 2 s rejects at
  purity (showcase rule; the tool would reject at the differential). check.mjs: `while (true) {}` rejected in ~8.1 s,
  which also exercises the heartbeat kill/respawn path of browserSandbox.
- Recorded candidates: tested via a page.route-injected TEST-ONLY fixture in check.mjs (nothing on disk); when Z3
  cannot run, the recorded SMT summary is shown labelled "replayed (recorded on <date> with Z3 <version>)".
- `run.passed` only when every stage passed (SMT "not available here" counts as not run, a no-verdict SMT does not pass).
- base './' verified with `node scripts/check.mjs --subdir` (served from apps/showcase, opened at /dist/).
- Root `pnpm build` green.
