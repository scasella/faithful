# Attribution

Faithful is a new codebase. Pieces listed here were adapted, with changes, from
[scasella/undefined](https://github.com/scasella/undefined) (MIT, © 2026 Stephen Casella):

| Faithful file | Adapted from | What was reused |
|---|---|---|
| `packages/engine/src/sandbox/mask.ts` | `src/sandbox/mask.ts` | Purity masking: shadow ambient globals with traps, intrinsic-integrity snapshot and restore |
| `packages/prover/src/codex.ts` | `server/codexService.ts` | One-`codex exec`-subprocess-per-request driver, serialized, argument shape |

Everything else is written for this one workflow.
