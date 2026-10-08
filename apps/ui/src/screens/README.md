# Screens

One folder per stage. Each exports a component with no props that reads `useApp()` (store + adapter).
Rules that stay in force:

- Use the shared components in `src/components/` (TierBadge, Evidence, ModelSaw, Code, ValueView, Funnel, Num, KeyHint,
  ActionButton, CatchCard). Do not print a tier label or a number without them.
- `ModelSaw` under every spec proposal, proof attempt and candidate.
- Every action is an `ActionButton` (key bound and shown). The only modal is the Agree confirmation.
- Read facts through `src/lib/facts.ts`; never print a number that is not in SessionState.
