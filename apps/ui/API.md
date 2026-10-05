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
between the Lean model and the TypeScript, that count is shown beside the sentence. (In this build the server records
the original's check when it writes the delivery, and none for candidates; their labels stay withheld until it does.)

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
