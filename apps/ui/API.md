# UI ↔ server contract

The browser UI talks to the local `faithful` server (packages/cli, bound to 127.0.0.1) through one port,
`Actions` in `src/actions.ts`, implemented over HTTP by `LiveAdapter` (`src/adapters/live.ts`).
This document is the route table a backend author implements. Types are those of `@faithful/session` and
`@faithful/translate`.

## Transport rules

- Every `/api/*` request carries `x-faithful-token: <token>`. The UI reads the token from
  `<meta name="faithful-token" content="…">`, which the server substitutes into `index.html` (`__FAITHFUL_TOKEN__`).
  `hostGuard` already rejects `/api/*` without it (401).
- Requests with a body send `content-type: application/json`. Responses are JSON.
- Errors: any non-2xx status with body `{ "error": "<plain-words message>" }`. The UI shows the message inline.
  Suggested statuses: 400 bad input, 409 wrong stage / no session, 423 another job is running.
- **Actions return when the work is accepted, not when it is done.** Every mutating route answers
  `{ "ok": true }` as soon as the job is queued; progress and results arrive only as `SessionEvent`s on the
  event stream. The UI never displays a result that did not come from an event.

## Routes

| Actions method | Method + path | Body | Response | Events the server then appends |
|---|---|---|---|---|
| `listFiles()` | `GET /api/files` | – | `Array<{ path: string; functions: Array<{ name: string; line: number; hasJsDoc: boolean }> }>` (paths relative to the repo root, exported functions only) | – |
| `functionStatus(files)` | `POST /api/functions/status` | `{ "files": string[] }` (at most 20 paths, relative to the repo root; more is 400) | `{ [file]: { [fn]: FunctionStatus } \| null }` (null: the file could not be read or is not a `.ts`/`.mts` file inside the repository). What Faithful can ATTEMPT for each exported function, see "What can run" below. Read-only, not a job, never writes. Replays and fixtures answer `null` (unknown). The pick lists no longer call it (the server ranks them: `pickFunctions`); the route and the port method stay | – |
| (one file) | `GET /api/functions/status?file=<path>` | – | `{ [fn]: FunctionStatus }` (400 outside the repository or not TypeScript, 404 missing). Same as above for one file | – |
| `pickFunctions(query, { limit?, includeUnrunnable? })` | `POST /api/functions/pick` | `{ "query": string, "limit"?: number, "includeUnrunnable"?: boolean }` (`limit` default 8, at most 50; a missing `query` is the empty query; a value of the wrong type is 400) | `PickResult`, see "What can run" below: the Pick list ranked by the SERVER over every exported function of the repository, from the background scan. Read-only, not a job, never writes. Starts the scan if none ran | – |
| `scanStatus()` | `GET /api/functions/scan` | – | `ScanStatus = { state: "idle" \| "running" \| "done", filesDone: number, filesTotal: number, version: number }`. Cheap; poll about every 1.5 s while `running`, stop at `done` | – |
| `startScan()` | `POST /api/functions/scan/start` | `{}` | `ScanStatus`. Idempotent: nothing happens while a pass runs or one finished less than 5 s ago; otherwise a new pass re-checks only what changed (statuses are cached by file content hash). Call it when the window regains focus | – |
| `openFunction(file, fn)` | `POST /api/session/open` | `{ "file": string, "fn": string }` | `{ ok: true }` | `session.started`, `translate.done` |
| `pasteFunction(source, fn?)` | `POST /api/session/paste` | `{ "source": string, "fn"?: string }` | `{ ok: true }` | `session.started` (file `""`), `translate.done` |
| `chooseThrow(choice)` | `POST /api/session/throw-choice` | `{ "choice": "precondition" \| "spec-case" }` | `{ ok: true }` | `throw.choice` |
| `proposeSpec()` | `POST /api/spec/propose` | `{}` | `{ ok: true }` | `call.recorded`, `spec.proposed`, `challenge.run` |
| `reviseSpec()` | `POST /api/spec/revise` | `{}` | `{ ok: true }` | `call.recorded`, `spec.proposed` (kind `revision`), `challenge.run` |
| `rerunChallenge()` | `POST /api/challenge/rerun` | `{}` | `{ ok: true }` | `challenge.run` |
| `carveOptions(challengeId)` | `GET /api/challenge/carve-options?challengeId=<id>` | – | `Array<{ cls: CarveClass; excluded: string }>` (the deterministic menu for that disagreement; not a job) | – |
| `rule(challengeId, ruling)` | `POST /api/challenge/rule` | `{ "challengeId": string, "ruling": RulingInput }` | `{ ok: true }` | `ruling.made` (server fills `challengeId` and `specHash` = hash of the latest proposal; for a carve-out it builds `carveOut`), then `challenge.run` after a carve-out |
| `agree()` | `POST /api/spec/agree` | `{}` | `{ ok: true }` | `spec.agreed` (409 while challenges are unruled) |
| `proveOriginal(budget)` | `POST /api/prove/original` | `{ "budget": { "maxAttempts": number, "minutes": number } }` | `{ ok: true }` | `proof.started` (its `ProofView.budget` is the budget requested), then per attempt `call.recorded` + `proof.attempt`, then `proof.done` |
| `startOptimize(threshold)` | `POST /api/optimize/start` | `{ "threshold": Threshold }` | `{ ok: true }` | `optimize.started`, per candidate `call.recorded`, `candidate.proposed`, `stage.result`×n, `candidate.decided`, `incumbent.changed`; finally `optimize.stopped` |
| `startTestedOnly(threshold, { specials? })` | `POST /api/tested/start` | `{ "threshold": Threshold, "specials"?: boolean }` | `{ ok: true }` (409 unless the function was refused) | `tested.started` (with `original`: `'extracted'` or `'file'`, and `included`: the declarations an extracted original ran with; both absent in older recordings), then as for `startOptimize` (`optimize.started`, candidates with `smt` and `proof` stages `skipped`, `optimize.stopped`); a candidate with any top-level statement besides the function (a copied constant, a helper) is rejected at the `compile` stage, since only the function is delivered; an overloaded function is refused before `tested.started`. `POST /api/deliver` then writes the Tested-only delivery. The UI says "the model could not be reached (...)" instead of "the model proposed no new candidate" when every candidate call since the last candidate recorded an error |
| `testedCheck()` | `GET /api/tested/check` | – | `{ ok: true }` or `{ ok: false, reason: string }` (409 when no function is open). The same checks a Tested run makes before it measures anything, on the same source it loads: the function extracted with only the module-level declarations it uses (`extractUnit`; the whole file when extraction refuses but the file passes; docs/SECURITY.md "Extracted units"), inputs from the TypeScript signature, the compile gate on that original, the real `Sandbox.load(.., { values: 'js' })` (unloaded right after), and the original on the first 50 generated inputs. `reason` is plain words, e.g. the function uses something imported from another module, a declaration it uses touches `Date.now` when the file loads, top-level code outside it changes state it reads, or it fails on every generated input. An unrelated import or top-level statement elsewhere in the file no longer blocks it. Read-only, not a job; `POST /api/tested/start` fails with the same reason (before `tested.started`). Replays and fixtures answer `null` (unknown) | – |
| `acceptFasterNotProved(id)` | `POST /api/optimize/accept-faster-not-proved` | `{ "candidateId": number }` | `{ ok: true }` | `candidate.decided` (outcome `accepted-at-verified`), `incumbent.changed` |
| `stopOptimize()` | `POST /api/optimize/stop` | `{}` | `{ ok: true }` | `optimize.stopped` (reason `user`) |
| `deliver()` | `POST /api/deliver` | `{}` | `{ ok: true }` | `model.checked` (the original's, when none is recorded and a proof is delivered), `deliver.done` |
| `doctor()` | `GET /api/doctor` | – | `DoctorCheck[]` (`{ id, label, status: "ok" \| "warn" \| "fail", detail, fix? }`) | – |
| (reconnect check) | `GET /api/session` | – | the current `SessionState` | – |

`RulingInput` (no free-text carve-outs; the server writes every carve-out condition):
`{ ruling: "spec-wrong", note? }`, `{ ruling: "function-wrong", then: "fix-original", note? }` or
`{ ruling: "function-wrong", then: "carve-out", carve: CarveClass, note? }`, where `CarveClass` is one `cls` from the
carve-options menu (`{ param, kind: "negative" | "zero" | "positive" | "equals" | "empty" | "length-equals" | "exact-input" }`).

Also built in: `GET /api/toolchain`, `POST /api/lean/check`.

### Jobs

Every mutating route except `POST /api/optimize/stop` runs as one server job at a time, bracketed by `job.started` /
`job.finished`, or `job.failed { job, message }` when it throws. A second request while one runs gets `423`.
`SessionState.job = { running, lastError }`: the UI shows a calm indicator with the job's name while `running`,
disables the actions that would start another (Stop stays enabled), and shows `lastError` inline until the next
`job.started` (the reducer clears it then). HTTP errors (`400`/`409`/`423`) are shown inline too.

## What can run (the pick lists)

`GET /api/files` is unchanged (one entry per function NAME per file: an overloaded function is listed once, at its lowest
line, documented when any of its declarations is; a symlink that leaves the repository is not listed) and never waits
on any of this. What Faithful can ATTEMPT for each function is decided by the server in the background and the page
asks for a ranked list, not for statuses to rank itself.

### The scan

`POST /api/functions/pick` (or `scan/start`) starts a background scan of the whole repository, once; a later pass
re-checks only the files whose content hash changed. Per pass: list the repository; then per file the translator's
verdict for each exported function (after this every provable function is known: this is what the first screen leads
with); then per file with functions the translator refused, the Tested preflight for each, the files the latest queries
match first, then files with documented functions. A file whose check itself failed (a worker died) is tried once more
in the same pass and at most three times in all; a function over the per-function cap is NOT retried while its content
stays the same. The scan is low priority: it pauses while a session job runs, between files AND between chunks of six
functions of one file (a file with hundreds of functions does not keep going to its end), and resumes when the job ends.
One consequence: the status routes share the scan's cached classification of a file (same content hash), so while a
session job runs, a status request for a file the scan is in the middle of waits until the job ends (the page does not
use the status routes). A preflight that runs past the cap is abandoned for real: its sandbox is aborted (`Sandbox.abort`), so a function that
loops stops using a core at once instead of for the 5 s its sample of 50 inputs would take, and the next preflight gets
a fresh sandbox. It writes nothing (not a file, not `.faithful`), never throws (a file that does not parse, is not text, or cannot be
read from inside the repository is that file's problem, never the scan's), and keeps only paths, content hashes and
statuses (no file text; at most 2,000 files and 60,000 functions are tracked).

The work runs in a small pool of worker threads (two), each with a sandbox of its own, so the server's thread never does
the translating, compiling or loading; a worker that stops answering (silent for the cap plus 20 s) or dies is replaced,
the functions it had decided are kept, and the one in progress is "took longer than 3 seconds" or "the check itself
failed". The cheap pass over a file (the translator's verdict for each of its exported functions) signs of life every 20
functions, so a file with thousands of exports is not mistaken for a stalled worker; one that really stays silent for 30 s
is killed, and every function of that file reads "Checking took longer than 30 seconds; not run." (decided for that
content, not asked again). Workers idle for a minute are ended and started again on demand. Requests the page waits for (the status routes)
go before the scan's. `FAITHFUL_TRIAGE_THREADS=0` runs it all on the main thread instead (the old behaviour; also the
fallback, said once on stderr, if worker threads cannot be started).

Measured on this repository (1,518 files, 2,088 functions; Node 25, a laptop; four full-scan runs through the real
server, built `dist`). These are the numbers of the first version of the scan; after the second review round (the
translator no longer repeats per-file work per function, chunked pausing, abort of an abandoned preflight) the whole scan
takes 19 to 20 s on 1,519 files and 2,095 functions, with the same first screen at about 2 s and event-loop stalls of
5 to 10 ms.

| | before (main thread, one sandbox) | now (two workers) |
|---|---|---|
| whole scan | 59 s | 32 to 38 s |
| first screen of eight provable functions | not available: only the first matches in search order were ranked | 1.6 to 2.2 s |
| longest event-loop stall during the scan | 156 to 200 ms | 6 to 12 ms (p99 under 5 ms) |
| one `POST /api/functions/status` of 20 unchecked files | 975 ms, event loop blocked 114 ms | 989 ms (includes starting the workers), event loop blocked 6.5 ms |
| a request during the scan (`pick`, `scan`) | – | median 1 to 2 ms, p99 under 7 ms; the first `pick` 0.5 to 0.7 s (it lists the repository) |
| a pass over an unchanged repository (`scan/start` a minute later) | – | 0.7 s, event loop blocked 5 ms, nothing changes (`version` stays), `filesDone` stays at the total |

The workers cost memory: the process went from 137 MB to about 700 to 860 MB resident during the scan (two workers, each a
TypeScript compiler and a sandbox; the JS heap of the server itself stays near 30 MB). Ending idle workers returns part of
it. The 7 functions that loop or run longer than the cap (all in `packages/translate/corpus-redteam`) come back as `unknown`
with "Checking took longer than 3 seconds; not run." and are not asked again while their file is unchanged.

### `PickResult`

```ts
{
  rows: Array<{ file: string; name: string; line: number; hasJsDoc: boolean; tier: 'provable' | 'tested' | 'unknown'; reason: string | null }>,
  totalMatches: number,                                   // every function matching the query, whatever its tier
  counts: { provable: number; tested: number; unknown: number; none: number },   // over ALL matches, not just the rows
  cannotRun: Array<same row, tier 'none', reason set>,    // only with includeUnrunnable, at most 200
  scan: ScanStatus,
}
```

- **Matching** is the page's own typeahead (apps/ui/src/screens/select/match.ts `rank`, copied into
  packages/cli/src/flow/scan.ts `matchRank`): exact name, name prefix, name contains, several words each in the path or
  name, path contains, letters of the name in order. The empty query matches everything.
- **Ranking**: tier (`provable`, then `tested`, then `unknown`), then name match (exact, prefix, contains, anything else:
  path, several words, letters in order), then documented functions first, then path, then line. A name that contains
  the query therefore outranks a path-only or scattered-letters match, whatever documentation either has. A function
  Faithful cannot run is never in `rows`.
- `rows` has at most `limit` entries. `counts` and `totalMatches` are over every match, so the page can say how many more
  there are and, behind "Show N functions Faithful can't run", how many cannot run (`counts.none`).
- **Overloads**: one row per (file, name), at the lowest line; an overloaded function is `none` and its reason says it is
  overloaded.
- **Staleness**: `pick` starts a new pass when the last one finished more than 15 s ago (a pass over an unchanged
  repository lists and hashes every file: about 0.7 s of background work, a few ms of event-loop time, nothing classified),
  so a file edited by another program while the page stays focused is noticed within about 15 s of the next ask; the
  page's window-focus re-ask (`scan/start`, a no-op within 5 s of the last finish) covers coming back to the window.
- `scan.version` increases whenever a ranking could change (the listing changed, a file was decided). While
  `scan.state` is `running` the page asks again when it moves (polling `GET /api/functions/scan`, about every 1.5 s) and
  re-ranks in place.
- `scan.filesDone` counts the files whose statuses are decided now, not per pass: a pass over an unchanged repository keeps
  it at `filesTotal` (it does not drop to 0 and count up again), so the page shows no progress line for it.

### What the page does with it (apps/ui/src/screens/select/pickView.ts, shared by Select and the Simple Pick step)

`Actions.pickFunctions`, `scanStatus` and `startScan` answer `null` in a replay or fixture (and `pickFunctions` failing on
the very first ask counts the same, with a one-line note): the pick lists then list `listFiles()` with their own
typeahead, in search order, without statuses, a can't-run toggle, a scan line or the footnote. Otherwise:

- **First screen**: one `pickFunctions('', { limit, includeUnrunnable: true })` on mount (limit 8 in Simple, 50 in Select).
  `includeUnrunnable` is always sent (loopback, at most 200 reasons), so the toggle and "only functions that can't run
  match" need no second request. Rows are shown in the server's order; the page does not re-rank.
- **Typing** asks again 150 ms after the last key (the latest ask wins). Until the answer to the current query arrives the
  rows of the older one stay, with a thin moving bar over the list (`aria-busy`; the text is not dimmed, so it keeps its
  contrast) and not openable (Enter and clicks do nothing). A failed ask keeps the rows and says they may be out of date.
- **While `scan.state` is `running`** the page polls `scanStatus()` every 1.5 s and asks `pickFunctions` again only when
  `version` moved or the scan ended; a poll never starts an ask while one is still on its way. Polling stops at `done`.
  Rows update in place, keyed by file, name and line: the highlight stays on its function (when it leaves the list it goes
  back to the best row, never to whatever now sits at its old position), nothing is focused or scrolled by an update (the
  page scrolls to the highlight only after an arrow key moved it), and the pointer only selects on `mousemove`.
- **A row that is still being checked ("Checking…") is not a choice yet**: it is never highlighted by default, the arrow
  keys skip it, the pointer does not select it, Enter and a click do nothing (`aria-disabled`), until the scan decides it.
  Before anything is decided nothing is highlighted. (A function that is undecided for another reason, over the cap or
  failed, is listed with its reason and can be opened.)
- **One quiet progress line** under the list while a pass has files left: "Checking the repository: 312 of 1,518 files"
  (plain text, not a live region). A pass with nothing left to decide (`filesDone` already at `filesTotal`, as for an
  unchanged repository) shows nothing. A separate screen-reader line (`role="status"`) changes text only when the progress
  line appears ("Checking the repository.") and when it goes ("Finished checking the repository."), never per tick.
- **Counts in words**, only from `counts` (over all matches), when the list is cut short or something is undecided:
  "Showing the best 8 of 1,585: 1,107 can have a proof attempted, 471 can be tested, 7 not checked. Keep typing to
  narrow the list." ("functions Faithful can run" is said of the total only when nothing in it is undecided: an aggregate
  that includes functions not checked yet would claim a capability before the check.) The words are the rows' words
  ("Proof can be attempted"): the aggregate never says "can be proved". While the scan runs and some of the list is
  decided it says "the best so far"; while NOTHING in the list is decided yet the rows are in file order and it says so:
  "Showing 8 of 2,094 functions in file order, not ranked yet." (never "the best" for an unranked list). The count of
  functions Faithful can't run is the toggle's label ("Show 500 functions Faithful can't run"), from `counts.none`; its
  list is `cannotRun` (20 reasons at first, "Show 20 more (180 left)" for the rest; a note says so when there are more
  than the 200 sent). No percentages anywhere; "can have a proof attempted" says what can be attempted, never that anything
  is proved.
- **Undecided rows say why**: a function the scan has not reached shows "Checking…" while the scan runs ("Not checked yet"
  otherwise); "Checking took longer than 3 seconds; not run." and "The check itself failed; not run." are shown as the
  server wrote them. They stay listed after the decided ones and can be opened.
- **Window focus** (and the tab becoming visible): `startScan()` (errors ignored), then one more ask, at most once a second.

### `FunctionStatus` (also what `POST /api/functions/status` answers)

`FunctionStatus = { tier: "provable" | "tested" | "none" | "unknown"; reason: string | null; included?: string[] }`
(`included` only in the status routes; the pick rows carry `tier` and `reason`):

| tier | meaning | shown as |
|---|---|---|
| `provable` | the deterministic translator accepts the function (the same `translate` the open route runs; no model, no Lean). Reported even if the Tested checks would also pass: the strongest wins | "Proof can be attempted" (plain muted text, never the tier badge) |
| `tested` | refused by the translator, but inputs can be generated from its signature (`inferSignature`) and its extracted unit (the function plus the module declarations it needs) loads in the isolated sandbox for real, as the Tested run loads it. `included`: those declarations' names | "Can be tested" |
| `none` | neither; `reason` in plain words (the Tested wording of `packages/session/src/tested.ts` plus the translator refusal's short title) | not in the list: behind "Show N functions Faithful can't run", greyed, with the reason, not selectable |
| `unknown` | not decided; `reason` says which: **not reached yet** ("Not checked yet: the scan has not reached it.": only the scan answers this, the status routes decide before they answer), **over the cap** ("Checking took longer than 3 seconds; not run.": decided for that content, kept, not retried), or **the check itself failed** ("The check itself failed; not run.": retried by the scan a bounded number of times, and by the next status request) | "Not checked yet" for the first, plainly the reason for the others; listed after the testable ones, never hidden |

A `none` reason is plain words, not compiler output (`pickReason`): a name the file neither defines nor gets from a plain
function run ("Cannot find name 'document'") becomes "it uses `document`, which the file does not define and a plain
function run does not provide (line 2, column 10)"; any other compiler diagnostic keeps only its first sentence, without
the compiler's advice about its own settings ("Do you need to change your target library? ..."); and the translator's
refusal is one parenthesis, "The translator refuses it too (input or output)."

`reason` is made safe for the page in one place (`tidyReason`, packages/cli/src/flow/triage.ts): at most 340 characters
(cut at a word, never inside a `code span`), white space collapsed, and no percent sign: compiler and extractor texts
quote source code and error messages, and a `%` on a page that makes claims reads as a percentage, so it is written
"mod" ("Error: 50 mod of the budget"). Reasons render `backtick` spans as code. The fixture
`packages/cli/src/flow/fixtures/pick-response.json` is what the server answers for a small repository (a test keeps it
equal to the real answer): feed it to the claim sweep.

### `POST /api/functions/status` and `GET /api/functions/status?file=`

Unchanged: the statuses of the exported functions of up to 20 files, in the same worker pool (before the pool's
background work), through the same cache. A file whose functions the scan already decided answers at once. A readable
file whose cheap pass failed or gave up still answers: each of its functions is `unknown` with the reason ("The check
itself failed; not run." or "Checking took longer than 30 seconds; not run."), not `null`; `null` means the file could not
be read from inside the repository. A function can be called anything, `__proto__`, `constructor` and `toString`
included: the answers are keyed by own entries. A path is
checked for containment on its real path too: a symlink inside the repository that points outside it is 400, as for
opening a function. An overloaded function is `none` ("... is overloaded ...; the Tested tier does not run overloaded
functions yet").

## Event stream

`GET /api/session/events[?since=<seq>]`, with the token header. `EventSource` cannot send headers, so the UI reads this
with `fetch()` and parses the stream itself (`src/lib/sse.ts`).

- Response: `200`, `content-type: text/event-stream`, `cache-control: no-store`, kept open.
- Each event is one SSE message:
  ```
  id: <seq>
  event: session
  data: <StampedEvent as one line of JSON>

  ```
- Without `since`, the server first replays every event of the current session from its first `seq`, then streams new
  ones. With `since=N`, it sends only events with `seq > N`.
- `seq` restarts when the server process restarts (it does not resume `.faithful/` on start), so `?since` cannot
  detect a restart: a restarted server has no event above the last seq the page saw. The UI therefore **always**
  connects without `since` and de-duplicates by seq and content: an event whose seq it has, with the same content, is
  skipped; one with the same seq and different content means the server restarted, so the UI resets its store and
  takes the server's events from the start. On a reconnect it also reads `GET /api/session`; a server without a
  session (`fn` empty) while the page shows one has restarted, and the page is cleared. Either way the page says so
  once. Reconnects back off 0.5 s → 8 s. `t` is ms since the session's first event.
  A new `session.started` resets the UI's state (the reducer does that), so one stream can carry several sessions.
- Send a comment line (`: keep-alive`) every 15 s so proxies and the browser keep the connection.
- Messages with another `event:` name are ignored by the UI (room for later additions).

Implementation note for packages/cli: the current `ApiHandler` shape (`await h(...)` then `JSON.stringify`) cannot
stream. Mount the events route as a raw `(req, res)` handler that runs after `guard(...)` and before the
`ApiRoutes` lookup, writes the headers above, and keeps `res` open (remove the subscriber on `req.on('close')`).
The server's CSP already allows `connect-src 'self'`.

## Stage details and the N in provedSentence(N)

`StageResult.detail` is read only through the typed shapes in `packages/session/src/details.ts` and their guards
(`isDifferentialDetail`, `isSmtDetail`, `isProofDetail`); a detail without its `stage` tag is not read, and a missing
field makes the UI omit the clause (it never substitutes another number).

| Stage | Fields read | Shown as |
|---|---|---|
| `differential` | `compared`, `seed` | "1,000 differential inputs." |
| `differential` | `skippedSlow` (optional, sent by the server) | "N generated inputs were skipped: the original takes more than 100 ms on them." |
| `differential` | `mutation.caught`, `mutation.total` | "12 of 12 broken copies of the original were caught by these inputs." (broken copies of the ORIGINAL, run on the same inputs) |
| `differential` | `mutation.undistinguished` | said separately, never counted as caught |
| `smt` | `k` (with stage status `pass`) | "Verified to k=6." |
| `proof` | `theoremId`, `attempts`, `axioms` | proof details |

The server's stage `summary` strings are shown in the funnel's tooltip and provenance popovers; a summary such as
"Proved against the agreed spec in 2 attempts" is reworded there ("Lean accepted a proof ..."), because "Proved"
appears only with provedSentence(N).

**N** comes only from `SessionState.modelChecks` (`model.checked` events): for a candidate's "Proved", the check with
`subject: "candidate"` and that `candidateId`; for the original's, the latest check with `subject: "original"`. When
none exists the UI withholds the label ("Lean proof accepted") and says why. When the check also found disagreements
between the Lean model and the TypeScript, that count is shown beside the sentence. (The server records the original's
check when its proof is accepted, and a candidate's check, on 600 inputs, when the candidate's proof is accepted.)

Candidate proof attempts carry no call ids in the detail: the UI finds their "What the model saw" by event order
(`proof-attempt` calls recorded between that candidate's `candidate.proposed` and the next one).

## Speedups and thresholds

`CandidateRecord.speedup` is versus the ORIGINAL on the declared distribution. "Faster" is `speedup.significant`, one
rule; the UI does not re-derive it from intervals. Whether a candidate beat the current best is the server's decision
(outcomes `incumbent` / `not-faster`). The declared distribution is calibrated by the server when optimizing starts and
shown with the baseline (`BenchSummary.distribution`, `sizes`).

Thresholds: `time-budget` (default, minutes); `speedup` (`target`; the server stops once the current best's speedup CI
lower bound reaches it; `distribution` is sent as a fixed descriptor, the server does not read it); `asymptotic` is not
implemented by the server and is shown disabled ("not available in this build").

Only a `faster-not-proved` candidate at tier `verified-to-k` can be accepted (`acceptFasterNotProved`); the server
refuses the others, and the UI says why instead of offering the action.

## Delivery

`deliver.done { dir: ".faithful/<fn>", files, at }`, files `<fn>.lean` (only with an accepted proof), `patch.diff`
(a placeholder when no candidate was delivered), `spec.md`, `<fn>.provenance.json`, `VERIFY.md`. The UI shows the
commands of VERIFY.md exactly: `faithful verify .faithful/<fn>`, and `git apply .faithful/<fn>/patch.diff` only when a
change was delivered for a file (not for pasted code). The user's file is never modified.

## Rejections (the CatchCard)

`candidate.decided` with outcome `rejected` and a `Rejection`:

- `kind: "smt-counterexample"` or `"counterexample"` must carry `counterexample: { input, original, candidate, source }`
  (both outcomes in the value domain, computed by running both functions on that input). The card says "differs" only
  when a counterexample is present and the two outcomes differ.
- `kind: "proof-failed"` should carry `theorem` and `goal` (the `⊢` goal state from Lean). The card says
  "not proved", never "wrong".
- A candidate rejected before the benchmark stage has `bench`/`speedup` `null`; the card says it was not benchmarked.
- `reason` is a plain-words sentence a developer can read in five seconds. If empty, the UI derives a neutral one from the
  counterexample.
- `bench`/`speedup` on a rejected candidate are optional. When present the card shows them struck through as the
  speedup given up; when absent it says the candidate was not benchmarked.

## Provenance

`reduce` never sets `SessionState.stamp`; the UI derives `{ date, modelId, toolchain }` from `session.started.toolchain`
(`capturedAt` date, `codex.model`). If the server later emits a per-figure stamp, put it in `SessionState.stamp` and the UI
will prefer it.

## Dev modes (no server needed)

- `?mock=catch`, `?mock=refused`: hand-authored fixtures played by `ReplayAdapter` (complete; `&play` plays from the
  start, `&speed=<n>`). The page shows "Development fixture, not a recording". `&interactive` drives the fixture
  through the real screens (`ScriptedAdapter`, which also emits the job events the server would).
- `?dev=gallery`: every shared component plus the whole `catch` session.
