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
- Fact: SMT wired in api.ts, showcase-record, measure.mjs; not in headless optimize / verify. TIERS.md/SMT.md stale on this.

- scripts/launch-tables.mjs (subagent): reproduces 74/39/35 coverage, library histogram, 3 of 39, 1 of 26 -> 12 of 26;
  tolerates partial/truncated results; self-check throws on any % outside "95% CI". `--write` run at 15:10 with the
  campaign at 2 of 74; headings demoted to sit under LAUNCH.md section 16.

## Remaining

- Re-run `node scripts/launch-tables.mjs --write` when the campaign finishes.
- Final media from a real recording (none exists yet), after `pnpm --filter @faithful/showcase build`.
