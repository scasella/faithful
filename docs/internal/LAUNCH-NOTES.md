Development log from the build, kept for provenance. It is not documentation and parts of it are superseded; the published docs and the code are authoritative.

# Launch work notes (2026-10-05)

Kept as I go so a crash loses little. Not user documentation.

## Done

- 1a speedup formatting (UI): apps/ui/src/lib/format.ts `speedupDecimals`, `canSayFaster`, `ratioText(speedup)`,
  `speedupCiText(speedup)`; two decimals when the ratio is within 0.5 of 1, more until a "faster" lower bound prints
  above 1; estimate and lower bound round down, upper up. Callers: lib/evidence.ts, screens/optimize/speed.ts
  (verdict "faster" now needs `canSayFaster`), OptimizeScreen.tsx, components/CatchCard.tsx. Tests in lib/lib.test.ts;
  two old expectations (optimize.test.ts, Evidence.test.ts) updated to the new text.
- 1a engine: packages/engine/src/evidence/evidence.ts HAD the same bug, worse (toFixed(1) rounds to nearest, so it
  could round a lower bound or the estimate up). Fixed with the same rule; a faster/slower verdict whose interval cannot
  print above 1 falls back to the no-claim sentence. Tests in evidence.test.ts; one expectation updated (0.97–1.08).
- 1b UI proof budget default 10 x 12 (proveModel.ts DEFAULT_BUDGET, `budgetText`), StartProof shows
  "This proof will run at most 10 attempts and 12 minutes. The default is ..., the same as the CLI and the API." Test in
  prove.test.ts.
- `pnpm exec vitest run apps/ui packages/engine/src/evidence`: 17 files, 195 tests pass. tsc clean (apps/ui, engine).

## Open

- packages/cli/src/flow/optimize.ts:341,370 and tested.ts:403,418 print stage summaries with toFixed(1) (same bug
  class); not in my scope, reported.

- scripts/make-media.mjs (subagent): tested on dev sample with --allow-dev-sample --use-existing-dist: MP4 414,825 B,
  31.30 s, 1280x720 h264 yuv420p; GIF 198,943 B, 31.30 s, 960x540. Refuses without the flag (exit 1), refuses files
  outside recordings/, exits 2 when the showcase dist is stale (unless --build). Test outputs deleted; docs/media/ absent.
- docs/LAUNCH.md written (16 sections, markers present; tables region still the placeholder until --write).
- README.md replaced. Memory file updated.
- Fact: SMT is wired in api.ts (`createApi` sets `rt.smt` when Z3 opens, which headless `faithful optimize` uses), showcase-record and measure.mjs; `faithful verify` passes `smtChecker` when Z3 is available (verifyCmd.ts). The earlier note here that it was not in headless optimize / verify was wrong.

- scripts/launch-tables.mjs (subagent): reproduces 74/39/35 coverage, library histogram, 3 of 39, 1 of 26 -> 12 of 26;
  tolerates partial/truncated results; self-check throws on any % outside "95% CI". `--write` run at 15:10 with the
  campaign at 2 of 74; headings demoted to sit under LAUNCH.md section 16.

## Remaining

- Re-run `node scripts/launch-tables.mjs --write` when the campaign finishes.
- Final media from a real recording (none exists yet), after `pnpm --filter @faithful/showcase build`.

## Media framing follow-up (17:23-17:28)

- make-media.mjs: default is now a PACED replay (steps events with `.` on a schedule: recorded gap/64 clamped to
  0.12-1 s, scaled to ~30 s; holds 3.2 s after candidate.decided, 1.2 s incumbent.changed, 0.9 s proof.done /
  spec.agreed / translate.done; 1.8 s start hold on the "replayed" heading). `--speed N` keeps uniform play.
  `--zoom` (default 0.75) sets CSS zoom on the document; a follow-scroll keeps the newest candidate card / proof attempt /
  Deliver evidence line in frame. Output on aliquotSum: MP4 947,434 B 30.20 s 1280x720; GIF 1,255,142 B 30.20 s 960x540.

## Spec faults are not disagreements (challenge search fix)

- Root cause (aliquotSum recording, challenge.run events 2-4): Lean's `#eval` of the SPEC produced no value ("no output
  from Lean": a 100-input `evalBatch` file timed out as a unit) on inputs such as n=0 and n=1. The challenge search
  counted spec=fault vs original=ok as a disagreement; the autopilot then carved out "n is 0" and "n is positive", and
  the session ended Proved for a theorem that covers only n < 0.
- Fix (packages/cli/src/flow/challenge.ts): spec faults are retried once in batches of 10, smallest input first, each
  call with budget/10 (retries capped at 2x the budget in total; an input that needs more than budget/10 alone stays a
  spec fault); what still faults is counted in `excluded.specFaults`, is not
  compared and is never listed. `faults` still means the ORIGINAL faulted. Inputs are now generated under the
  preconditions without the carve-outs, then carve-outs drop theirs: `excluded.carvedOut` of
  `excluded.generatedBeforeCarveOuts` (previously always 0); generation scales up (at most 4n) so the compared count
  does not collapse under carve-outs.
- `agreeBlocker` (runtime.ts, mirrored by the UI's agreeGate) blocks when no input was compared, or when spec faults
  are at least as many as the compared inputs, so slow-input faults cannot hide a real disagreement. The autopilot never sees spec-fault disagreements, and stops BLOCKED at
  agreement when its carve-outs exclude at least half of the generated inputs (note on that carve-out ruling).
  `faithful optimize` prints the carved-out count after a carve-out.
- Recordings and campaign rows made before this fix may show spec faults as disagreements (spec `{"tag":"fault"}`),
  carve-out rulings made because of them, and `carvedOut: 0` with no `specFaults` / `generatedBeforeCarveOuts`.
  aliquotSum.json is one. Tests: packages/cli/src/flow/challenge.test.ts.

## GUI redesign and media (2026-10-05, evening)

- Landing page (apps/ui/src/landing) is the showcase front page; the local UI shows it when the session cookie
  `faithful_start=landing` is set (checkbox on the page; "About Faithful" in the top bar). Numbers on it are checked
  against the recordings by apps/ui/src/landing/content.test.ts.
- Default showcase recording is now clamp. README media regenerated from clamp.json:
  `node scripts/make-media.mjs apps/showcase/public/recordings/clamp.json --use-existing-dist` (MP4 691,691 B 27.5 s
  1280x720; GIF 776,047 B 27.5 s 960x540).
- Screenshots in docs/media/gui are not in the repository; they are generated by apps/ui/scripts/shoot*.mjs (shoot.mjs, shoot-simple.mjs, shoot-pick-live.mjs), each of which writes to the <outDir> you pass.
- Open: the claim sweep's percent rule would flag `%` (modulo) inside code in real recordings; fixtures contain none.
  aliquotSum.json should be re-recorded after the spec-fault fix.

## Tested tier: extracted units (2026-10-06)

- The Tested tier now runs the function as an extracted unit (the function plus only the module-level declarations it
  uses; packages/engine/src/sandbox/extract.ts, rules in docs/SECURITY.md "Extracted units") instead of the whole file.
  Preflight (`testedPreflight`, packages/cli/src/flow/testedOriginal.ts) = extraction, signature, compile gate on the
  original alone, the real sandbox load, and the original on the first 50 generated inputs; the run, delivery and
  `faithful verify` use the same unit. Whole file as fallback when extraction refuses but the file passes.
- Measured once on this repository (2026-10-06; every exported function `GET /api/files` lists, 2,076 functions incl.
  the translator corpus and library samples; a throwaway script, not committed): `extractUnit` succeeds for 1,667.
  The translator refuses 969; of those the Tested preflight passed for 456 before (whole file loaded + signature) and
  passes for 478 now (all as extracted units; the whole-file fallback was never needed here): 60 newly runnable, 38 no
  longer offered. All 38 were offers the old preflight made that the run could not complete: the original does not
  compile alone under the compile gate (types imported from another module, DOM globals such as `document`, `console`,
  ES2023 array methods, deliberate type errors in the red-team corpus, a missing `CASE_SPLIT_PATTERN`), the original
  faults on every generated input (returns a function or a Promise, stack overflow, TDZ / const-assignment errors), or a
  `declare`d value.
- Showcase functions: `liveSandboxWorkers` (apps/showcase/src/live/browserSandbox.ts) extracts (included: `live`, line
  70; the unrelated imports and the `Sandbox` class are left out), but the preflight refuses it: `new Set<Worker>()`
  does not compile under the compile gate's ES2022 library ("Cannot find name 'Worker'", line 70), so every candidate
  would be rejected. `browserZ3` and `runZ3` (z3Driver.ts) are refused by extraction: their types use `Z3Driver` /
  `SmtResult` imported from the SMT package. `z3Available` extracts with nothing included but does not compile alone
  (`globalThis.crossOriginIsolated` is not in the ES2022 typings, line 71), and it would fault on every call anyway
  (`globalThis` is trapped in the sandbox); `z3Base` does not compile alone (`URL` is not in the ES2022 library, line 26).


## Extraction and triage: review fixes (2026-10-06)

- Soundness guard (extract.ts rule 5, docs/SECURITY.md "Extracted units") tightened after a review found shapes that
  extracted with a false "that code did not run" caveat and then behaved differently from the whole file: IIFEs,
  callbacks and getters run at load, computed keys, decorators, static blocks through `this`, tagged templates,
  `instanceof` (`Symbol.hasInstance`), a user `valueOf`, properties attached to an included function
  (`Object.defineProperty(h, ...)` read through `as any`, element access or an alias), changes to built-ins
  (`Array.prototype.includes = ...`, `Object.getPrototypeOf([])`, `Object.assign(Math, ...)`), `eval` / `Function`.
  Every one is now refused (a differential test per shape in extract.test.ts: refusal required, and the shapes still
  allowed are compared with the whole file in the sandbox). The caveat now says the code "runs only when called; nothing
  in the file calls it while the file loads".
- Overloaded functions are refused on the Tested tier (unit and whole file): the patch splice replaced only the first
  signature and the inputs came from the first signature only.
- A Tested candidate with top-level code besides the function is rejected at the compile stage (only the function is
  delivered, so a copied constant would be tested but not shipped).
- Triage: the whole-file fallback is refused by `prepareSource` before the compile gate (packages/smt/src/values.ts
  froze the server for about 9.7 s; now 0 ms on that file, maximum event-loop lag over a full-repo scan 200 ms); the cap
  timer starts before the synchronous work; a preflight past its cap holds the triage lane until it settles (no cascade
  of "not checked yet"); symlinks out of the repository are refused (triage and `openFunction`).
- Full-repo triage scan after the fixes (1,515 files, cap 3 s, read-only script in the session scratchpad): provable
  1,107, tested 471, none 487, unknown 7 (all seven are red-team corpus functions that loop or run long, e.g. `stuck`,
  `spinNeg`; before the lane fix 14 were unknown, including trivially fast ones). Before the review fixes the same scan
  at a 60 s cap gave tested 478, none 479.
- UI (the client-side ranking described here was replaced the same day: see "Pick list over the whole repository"
  below): the pick lists keep the selection on the same function when statuses re-rank the rows; reasons render
  backtick spans as code; Full Select rows are at least
  44px on a name | path | status grid. Simple Result shows "What ran as the original" and offers "Pick another
  function" before and after delivery. The Tested delivery's verify text promises a differential re-run only when an
  optimized function was delivered. A stop after only failed model calls says "the model could not be reached".
- Not changed at that point, fixed afterwards (next section): the empty-query first screen on a large repository showed
  the first runnable matches in search order (no provable one on this repository), and the compile gate ran
  synchronously on the server thread.


## Pick list over the whole repository (2026-10-06, uncommitted)

Open issues of the previous section, and what was done about each. The server half is packages/cli/src/flow/{scan,
triage,triagePool,triageWorker,triageProtocol,files}.ts, the page half apps/ui/src/screens/select/pickView.ts (+
CannotRun.tsx, runnable.ts) used by Select and the Simple Pick step; the routes are in apps/ui/API.md.

- **First screen (was: no provable function on this repository).** A background scan of the whole repository, started by
  the first `POST /api/functions/pick` (or `scan/start`), ranks over every known status on the server; the page asks
  again when `scan.version` moves and re-ranks in place (the highlight stays on its function, nothing takes focus). The
  scan is read-only (no `.faithful`), pauses while a session job runs, and re-checks only files whose content hash
  changed.
- **Server stays responsive (was: classification on the main thread).** translate, `testedPreflight` and the compile
  gate run in two worker threads with a watchdog (a stalled or dead worker is replaced; what it had decided is kept).
  `FAITHFUL_TRIAGE_THREADS=0` restores the in-thread behaviour.
- **Overloads.** `listFiles` lists one entry per name per file at its lowest line; an overloaded function is `none` and
  its reason says so.
- **Reasons.** One place makes a reason safe for the page (`tidyReason`: at most 340 characters, never cut inside a code
  span, white space collapsed, `%` written as "mod"). The claim sweep covers real server answers from the fixture
  packages/cli/src/flow/fixtures/pick-response.json (kept equal to the server's answer by a test).
- **Functions that stay unknown.** Three plain causes: "Not checked yet: the scan has not reached it.", "Checking took
  longer than 3 seconds; not run." (kept for that content, not retried), "The check itself failed; not run." (retried a
  bounded number of times).
- **Window focus.** The page calls `scan/start` and asks again when the window regains focus (at most once a second);
  the server answers from its content-hash cache.
- **Extraction precision (item 3): no function became runnable, and that is the finding.** Over a frozen snapshot of this
  repository (1,559 `.ts` files, 2,088 exported functions, 981 of them refused by the translator; the server's listing
  counts 1,518 files with 2,088 functions at that time and 1,519 files with 2,090 a little later in the live runs below:
  different bases, the same repository) the extractor's refusals went from
  420 to 414; Tested status 481 extracted-unit, 0 whole-file (was 479 and 2), none 500 unchanged. 373 of the 414 refusals
  are imports (290 an imported type in the signature or body, 83 an imported value), 19 are const/arrow-stored targets,
  9 do not parse, 7 are overloads, and rule 5 (code that runs when the file loads) accounts for 9 (the five
  `const RealFunction = Function` aliases in the sandbox's mask.ts and `sha256Bytes` no longer refused; two genuine
  `Math` patches still are). A seeded sample of 25 refusals: 25 of 25 needed. Two relaxations (a dropped alias of
  `eval`/`Function`/`getPrototypeOf` is checked at each reference; a dropped function only stored in the default export
  is not running code); five unsoundness holes found by probing and closed (`globalThis.x = ...`, code from a string
  reached through `.constructor`, a kept or called `getPrototypeOf` result, a direct `eval` in the function's own
  closure, a key built at run time read into a binding); 148 extract tests, the 95 originals and the 31 review shapes
  included. "Included code's own changes to built-ins when called" is covered when the code runs (the sandbox purity mask
  faults the call, the built-in is restored, the input is excluded and counted), not by static analysis; docs/SECURITY.md
  says so. The larger lever would be a types-only closure across files (inlining imported type declarations), a
  resolver feature outside the extractor guard.

### Measured on this repository, through the real server (1,519 files with exported functions, 2,090 functions)

Server started from `packages/cli/dist` with `--port <p> --no-open` at the repository root, the Simple Pick opened in
headless Chrome at 1280 wide (`/?view=simple`, nothing clicked), the server's own event-loop lag sampled every 10 ms
inside its process (a `--import` probe in the scratchpad), `GET` probes from Node. Two runs on a fresh server each.

| | run 1 | run 2 (also `GET /api/files` repeatedly) |
|---|---|---|
| first rows on screen (all "Checking…", search order) | 0.42 s | 0.38 s |
| first provable rows on screen | 1.97 s | 1.93 s |
| whole scan, first `pick` to `state: done` | 31.6 s | 32.0 s |
| longest event-loop stall during the scan | 4.5 ms | 5.6 ms |
| `GET /api/functions/scan` during the scan | median 0.6 ms, max 1.2 ms (n 607) | median 0.6 ms, max 4.8 ms (n 619) |
| `GET /api/files` idle, then during the scan | – | median 243 ms (max 311), then 218 ms (max 356, n 99) |
| resident memory idle, peak during the scan | 205 MB, 914 MB | 205 MB, 946 MB |

- The end state of the empty-query first screen is eight provable functions (startCookie, viewCookie, aliquotSum, clamp,
  fibRecursive, sum, countOccurrences, dedupe), "Showing the best 8 of 1,589: 1,107 can be proved, 475 can be tested, 7
  not checked" (the wording of that run; since the second review it says "can have a proof attempted"), and "Show 501
  functions Faithful can't run". (Both runs: provable 1,107, tested 475, unknown 7, none 501;
  one more file and function than the earlier 1,518-file measurement.)
- `GET /api/files` lists the repository itself (about a quarter of a second); it is no slower while the scan runs. The
  longest stall of 4.5 to 5.6 ms equals the idle baseline (2 to 5 ms). The 145 ms in the first lag window is process
  start, before the server listens.
- The page made 18 to 20 `pick` asks and 21 to 22 scan polls during a 32 s scan, and no `POST` outside
  `/api/functions/*` (a Pick that starts a model job would be one). After the scan the focus re-ask sent `scan/start`
  and one `pick`. With the can't-run list opened (46,000 characters of page text, 200 reasons) there is no `%` on the
  page, and none in the reasons of the 8 + 200 rows asked.
- Resident memory is the known cost of two workers (a TypeScript compiler and a sandbox each); it stayed at 850 to 880
  MB for the 25 s observed after the scan (workers are ended after a minute idle; not observed here).

### Media regenerated (item 6) without touching the real `.faithful`

The pick-first-*, pick-cannot-open-* and pick-tested-offer-* screenshots (1280 and 375, light and dark; not in the repository) come from
`apps/ui/scripts/shoot-pick-live.mjs` against the real server on a small throwaway repository (no `.git`): provable
`clamp`, `digitSum`, `factorial`; `distance` (`Math.sqrt`: Tested only; the screen shows "Math.sqrt produces non-integer
numbers"); `countWords` in a file with an unused import (can be tested) next to `lineId` which uses `createHash` (can't
run); an overloaded `pad` (can't run, reason says overloaded); `drain` that never finishes ("Checking took longer than 3
seconds; not run."). The script aborts every request that is not ranking or opening a function, so no model job can
start, and the only function opened (`distance`) wrote its session into the throwaway repository's `.faithful`.
The real repository's `.faithful` tree hash was identical before and after every step (server runs, screenshots).
01-pick-* (the fixture Pick) were re-shot with shoot-simple.mjs for the row layout below; the other 52 images of that set
were re-shot into the scratchpad and not copied, since nothing else on them changed.

Visible defect found and fixed: Simple Pick rows were a wrapping flex line, so on the same screen one row put its path
beside the name and the next put the path on its own line, and at 1280 a long path pushed the status onto a third line.
A row is now always the name with its status on the right and the path under it (name, path, status on three lines
below 520 px): `.s-results li` in apps/ui/src/simple/simple.css.

### Still open

- Memory: two workers hold about 700 to 950 MB resident during a scan; lowering the old-generation cap risks running out
  of memory on a huge file, and ending idle workers returns only part of it.
- A function over the per-function cap stays "took longer than 3 seconds" while its file is unchanged (no retry), even
  if it was only slow under load.
- A pass over an unchanged repository re-reads and re-hashes every file (0.7 s, 5 ms stall); no mtime skip.
- The first request that needs workers pays about 0.5 to 1 s of start-up.
- 290 functions are refused only because their signature uses an imported type, 83 an imported value, 19 are
  const/arrow-stored: the Tested path does not follow imports (types-only closure) or const-stored functions yet.
- The extractor's new refusals over-approximate in four shapes (`.constructor` in a class body that load-time code
  reaches, `anyGlobal[k]` read into a binding, `eval?.()` treated as direct, `getPrototypeOf` on the file's own classes
  bound at load). None occurs in this repository; elsewhere they would refuse a harmless file. Aliases of namespaces and
  prototype methods (`const { floor } = Math`), static class fields and load-time initialiser loops stay refused until a
  real file needs them.
- No live drive of opening a provable function was done (the next step after Translate is a spec proposal, a model call);
  open and paste flows are covered by DOM tests only.

## Review round 2: extraction soundness, scanner, Pick page (2026-10-06, uncommitted)

A second review of the extractor, the scan and the Pick page found real problems. Each was reproduced first, fixed with a
regression test that fails on the code before the fix, or (extractor) made conservative. Numbers are from this tree.

### Extractor (packages/engine/src/sandbox/extract.ts, rules in docs/SECURITY.md "Extracted units")

One hole was introduced by the previous round's relaxations (the `arguments` exemption) and is reverted to the safe
behaviour; five were old and are closed. In every case the guard became stricter, never looser.

| finding | now |
|---|---|
| `arguments.__proto__.k = ...` accepted (the exemption returned before the chain check): the unit differed from the file | `arguments` is checked like a binding of the file: `arguments[0] = 1` stays allowed, a changed or passed `__proto__` is refused |
| a `var` nested in a block of dropped code (`if (c) { var x = 100 }`, `for (var x of ...)`, `try { var x }`, destructuring) re-declared or hoisted a module variable the function reads | such a name is refused in the closure walk, also when the block is the only declaration and when a function is re-declared by a var (the checker gives them different symbols); the target's own name too |
| a polyfill installer that only load-time code calls (`function patch() { Array.prototype.x = ... } patch();`, `function M() { return Math } M().max = ...`) | the body of every included function that load-time code runs or passes on is scanned like load-time code; the SECURITY.md sentence about "caught when it runs" now says it holds when the FUNCTION calls it |
| `new Box()` / `helper.call(...)` did not count as using an included function as an object, so `Object.assign(Box.prototype, ...)` or `Object.defineProperty(helper, 'call', ...)` at load was accepted | only a plain call `h(x)` or a tagged template is "only called" |
| a shorthand `{ Math }` resolved to the property symbol, so the whole built-in branch was skipped | `symbolOf` (the value symbol) |
| a method CALLED on a prototype (`Array.prototype.push(1)`, `Object.prototype.__defineGetter__(...)`, `[].__proto__.push(7)`) | refused (`.call` / `.apply` / `.bind` only look a method up and stay allowed) |
| destructuring with static names reached `constructor`, `__proto__`, `prototype`, `eval`, `Function` unseen | a pattern that picks one of them, in dropped load-time code, is refused |

- Tests: extract.test.ts 148 -> 183. 31 new tests refuse a shape AND require that the unit the guard would have produced
  behaves differently from the file in a fresh `vm` context; all 31 fail on the extractor before this round. Four allowed
  shapes pin the precision (read-only `arguments.__proto__`, `Object.prototype.hasOwnProperty.call`, a computing helper
  called at load, a top-level `for (var i ...)` next to a function with a `var i` of its own).
- The review's own batteries and fuzz against the new guard: 5 case files (all the shapes of the finding) leave only the
  documented limit (a key built at run time and called straight away: 4 rows) and 7 "the whole file throws, the unit does
  not" rows (by design, rule 4); about 7,350 random programs over three seeds leave 0 differences between unit and file.
- Precision over this whole tree (2,543 top-level function declarations in 1,677 files, tests included): 1 verdict
  changed, accepted -> refused: `apps/ui/src/app/claims.sweep.test.ts` `attrText` (`.filter(Boolean)` inside an included
  function that load-time `describe` callbacks reach; passing `Boolean` on is refused like any built-in). 1,737 -> 1,736
  accepted. On the frozen snapshot of the previous round (2,088 functions, 981 refused by the translator): extraction
  refusals 414 before and after (the original, pre-extraction figure was 420).
- Deferred, deliberately: a purity probe that also loads the whole file once in the sandbox and refuses the unit when the
  file reports "impure at load". It would cover several run-time-key shapes but not files with value imports or the
  closure-state holes, and it costs a load per function; the static fixes stay primary.

### Scanner and server

| finding | now |
|---|---|
| the cheap pass called `translate` once per export and each call re-parsed and re-checked the whole file: 289 KB / 1,500 exports took 27.2 s, 146 KB / 2,400 one-line exports 127 s and hit the 30 s watchdog, every function ended "the check itself failed" | the translator reuses the program of the last source and caches per tree what it asked of the whole file per function (the comment-directive scans, the identifier set): 1.0 s and 2.7 s. The worker also signs of life every 20 functions, so a long pass is not a stall; one that stays silent for 30 s is killed and says "Checking took longer than 30 seconds; not run." (kept for that content), not "failed". Through the real pool: before, the scan of both files took 90 s and left 2,400 unknown; now 48.6 s, 2,400 provable and 1,500 tested, nothing killed |
| a readable file whose cheap pass failed answered `null` on the status route | each of its functions is `unknown` with the reason; `null` is only for a file that cannot be read |
| "the scan pauses while a job runs" held only between files; an abandoned preflight kept its sandbox thread busy | a file's functions go to the backend six at a time with a pause check before each chunk; a preflight past its cap aborts its sandbox (`Sandbox.abort()`, new) and the next one opens a fresh sandbox. The review's reproduction (a `while (true)` function): about 1,030 ms of CPU per second for 5 s after the pool reported idle, now 0 ms |
| within a tier a path-only or scattered-letters match outranked an undocumented name-contains match | exact, prefix, contains, then the rest (documented first, path, line) |
| a function named `__proto__` was lost; `constructor` and `toString` were read through the prototype; `counts` could gain an `undefined` key | name-keyed records are built with `newRecord`/`setOwn` and read with `getOwn`, also across the worker boundary and in the scan; a test with six such names through stub, worker pool and JSON |
| after an external edit `pick` answered from stale statuses for up to 60 s | `pick` starts a pass when the last one finished more than 15 s ago (0.7 s of background work over an unchanged repository); the window-focus re-ask still covers coming back to the window |

Measured through the real server on this repository (1,519 files, 2,095 functions; a laptop shared with another agent's
long-running job, so times are upper bounds), two runs on a fresh server each:

| | before this round | now |
|---|---|---|
| whole scan, first `pick` to `state: done` | 31.6 s, 32.0 s | 19.8 s, 18.9 s |
| first rows on screen (all "Checking…") | 0.38 to 0.42 s | 0.54 s, 0.38 s |
| first provable rows on screen | 1.93 to 1.97 s | 2.09 s, 1.93 s |
| longest event-loop stall during the scan (own process, 10 ms samples; the first 175 to 195 ms window is process start, before it listens) | 4.5 ms, 5.6 ms | 5.4 ms (also 58 `GET /api/files`), 10.3 ms |
| `GET /api/functions/scan` during the scan | median 0.6 ms, max 1.2 to 4.8 ms | median 0.6 to 0.7 ms, max 1.2 to 5.2 ms |
| resident memory idle, peak | 205 MB, 914 to 946 MB | 221 to 224 MB, 933 to 973 MB |
| end state | provable 1,107, tested 475, none 501, unknown 7 | provable 1,107, tested 475, none 506, unknown 7 (five more exported functions than the earlier run: helpers added by this round, none of which the Tested tier can run: the generic `newRecord`, `setOwn`, `getOwn`, `mergeInto`, and `openable`, whose parameter is a union of several types) |

The faster scan is the translator fix: the same per-file work was being repeated per function for the provable ones too.

### Page (apps/ui/src/screens/select, apps/ui/src/simple)

| finding | now |
|---|---|
| "Showing the best 8" before anything was ranked (the rows were the first eight in file order, all "Checking…") | "Showing 8 of 2,095 functions in file order, not ranked yet." until something is decided, then "the best so far", then "the best" when the scan is done |
| a row that said "Checking…" could be opened by click or Enter, and the highlight sat on it; about 2 s later the list re-ranked and the highlight moved to another function | a row still being checked is never highlighted by default, skipped by the arrows, not selected by the pointer, and Enter and a click do nothing (`aria-disabled`); nothing is highlighted before anything is decided. When the chosen function leaves the list the highlight goes back to the best row, not to whatever sits where it was. Checked in headless Chrome on a fresh server on this repository: Enter, ArrowDown, Enter and two forced clicks while every row said "Checking…" sent 0 `session/open`; once the first row was decided Enter opened it (the request was aborted by a route guard, nothing started) |
| the list was dimmed to 0.55 while a newer query was asked (text at 2.3 to 3.6:1) | no dimming; a thin moving bar over the list (`aria-busy` for assistive technology). Measured while pending: opacity 1, names 16.05:1, status and path 6.51:1 |
| a re-rank scrolled the page | the page scrolls to the highlight only after an arrow key moved it |
| compiler text in reasons ("Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to..."), cut mid-sentence; "The translator refuses it too: input or output." | `pickReason`: a name the file neither defines nor gets from a plain run becomes "it uses `document`, which the file does not define and a plain function run does not provide (line 3, column 10)"; another diagnostic keeps its first sentence without the compiler's advice; the translator clause is one parenthesis ("The translator refuses it too (input or output)."); the Tested path's trailing advice "so there is nothing to compare a faster version with" is dropped, and a reason that still has to be cut ends with an ellipsis and is not followed by another sentence. Over the 513 reasons of this repository (read through `POST /api/functions/status`, all 1,519 files): before, 38 held a raw diagnostic and 11 were cut mid-sentence and ran into the next one; now 0 carry the compiler's advice, 0 are cut, 0 use the old clause, 9 are the plain "uses `X`, which the file does not define ..." sentence, 29 still quote the first sentence of a compile diagnostic (a long tail of different messages), 9 quote a parse error, none has a percent sign, the longest is 268 characters |
| opening "Show N functions Faithful can't run" rendered up to 200 reasons: 16,731 px at 1280, 27,495 px at 375 | 20 at first and "Show 20 more (180 left)"; 3,279 px at 1280 |
| can't-run rows put the path beside a short name and under a long one | name, path, reason, always in that order |
| rows said "Proof can be attempted", the count said "1,107 can be proved" | the count says "can have a proof attempted" |

Tests: the full suite on the finished tree (after `pnpm build`): 73 files, 3,798 tests, all green (3,732 at the start of this round; the suite
includes the pre-existing tests that call real Lean and Z3, with temp directories); runnable.test.ts 54 tests over both views (new: nothing openable while checking, the note before and after ranking,
no scroll on re-rank, the 20-at-a-time list); the claim sweep covers every stage of the counts note and the new reasons.

### Media (without touching the real `.faithful`)

pick-first-* and pick-cannot-open-* (8 images) regenerated by `apps/ui/scripts/shoot-pick-live.mjs` against a server on a
copy of the small throwaway repository (plus `titleLength`, which reads `document`, to show the new reason); its `.faithful`
holds the one session the script opens. pick-tested-offer-* (4) came out byte-identical, 01-pick-* too. 08-result-*,
09-delivered-* and 14-tested-result-* (12 images) were stale since the previous round added "Pick another function" to
the Result screen (that round re-shot them to the scratchpad and judged them unchanged: wrong); regenerated with
shoot-simple.mjs. The real repository's `.faithful` tree hash `1942233b...` (14 entries) was identical before and after
every server run, the browser checks and the screenshots.

### Still open after this round

- The status routes share the scan's cached classification of a file, so while a session job runs a status request for a
  file the scan is in the middle of waits until the job ends (before, the scan paused only between files, so a shared
  classification always completed). The page does not use those routes; stated in apps/ui/API.md.

- Memory: two workers hold about 930 to 970 MB resident during a scan (unchanged).
- The sandbox purity probe above is not built.
- A function over the per-function cap stays "took longer than 3 seconds" while its file is unchanged, even if it was only
  slow under load. The same now holds for a file whose cheap pass gave up ("longer than 30 seconds").
- The extractor still refuses 290 functions for an imported type, 83 for an imported value, 19 for const/arrow storage.
- The reviewers' evidence screenshots from earlier rounds (some from this one) are not product media and are not published.
- Opening a provable function in the live UI (the next step is a spec proposal, a model call) is still covered by DOM
  tests only.
