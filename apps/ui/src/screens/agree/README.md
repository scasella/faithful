# Select, Translate, Agree: contracts these screens assume

The screens send only what the `Actions` port defines (`src/actions.ts`, route table in `apps/ui/API.md`). The
backend must match these assumptions:

## Rulings (`POST /api/challenge/rule`)

| Key path | Payload (`RulingInput`) |
|---|---|
| `s` | `{ ruling: "spec-wrong" }`. The spec is then revised (`v`, `POST /api/spec/revise`; the server revises only from these rulings). |
| `f`, then `x` | `{ ruling: "function-wrong", then: "fix-original" }`. Agree stays unavailable: the user edits the file and opens the function again. |
| `f`, then `c`, then `1`–`9` | `{ ruling: "function-wrong", then: "carve-out", carve: <CarveClass> }`, the class picked from `GET /api/challenge/carve-options?challengeId=<id>` |

**No free-text carve-outs.** The server offers a deterministic menu of classes for the disagreeing input (negative,
zero, positive, exactly this value, empty, this length, only this input) and builds the Lean and TypeScript conditions
itself (packages/cli/src/flow/carveout.ts). Its `ruling.made` event carries the resulting `carveOut` precondition,
which is what the carve-out band shows. A carve-out ruling makes the server re-run the challenge.

## Agree gate

`agreeGate` in `gate.ts` decides whether Agree is available, and mirrors the server's `agreeBlocker` (409):

- Agree is unavailable while a challenge in the latest run against the latest spec has no ruling.
- It is unavailable while a ruling in that run is "spec-wrong" (revise first) or "fix-original".
- It is unavailable when the latest run did not run under the current carve-outs (`carveOutIds`).
- It is unavailable while the latest run found any disagreement (`totalDisagreements`), even ruled ones.
- A spec the server did not accept (`validation.ok === false`, e.g. one that merely calls the Lean model) cannot be
  agreed; its errors are shown verbatim and `n` asks for a new one.

A ruling on an older spec hash never counts for a newer proposal.

## Agreement hash

The UI does not compute or predict the agreement hash. Before agreeing, the modal shows the latest proposal's
`validation.hash`, which came from an event, and says the agreement hash is computed over the listed items when the
user agrees. After `spec.agreed`, the screen shows `Agreement.hash` exactly as the server emitted it. A route that
returns the would-be agreement hash before agreeing would let the modal show the exact hash.

## Examples table

No examples field exists in `SessionState`. The table lists every disagreement recorded against the latest spec,
across its challenge runs, with its ruling. It then states how many other compared inputs agreed; those inputs are not
recorded. A real examples field (spec answers on representative inputs) on `SpecProposal` or `ChallengeRun` would
fill the table properly.

## Shared pieces for other screens

- `components/CarveOutBand.tsx` is the sticky carve-out band. Mount `<CarveOutBand state={s} />` at the top of any
  screen to keep carve-outs visible after the Agree stage. The shell does not mount it.
- `components/Preconditions.tsx` renders preconditions in plain words. Translate, Agree and the Agree confirmation all
  use it, so the sentences are identical everywhere.
