# Candidate-proof experiment log (appended after every experiment)

2026-10-05. TUNE = 17 candidates / 8 functions (split.json). Budget 8 attempts / 12 min per candidate, proof effort high.

1. collect-candidates.mjs: 50 candidates / 24 functions kept (candidates.jsonl), 69 excluded (excluded.jsonl).
2. range-screen.mjs on all 50 (no model): 1 refuted (array/maxWindowSum#1, held-out).
3. cproofs-tune-base: old code (single theorem, --lib v1, no guide). proved 1/17 (numeric/clamp#1). 132 attempts, 145 proof-min, 132 calls, 3.93M/400k tokens.
4. cproofs-tune-a-split: split, old lib, no guide. proved 1/17 (clamp#1); equality parts 2, range parts 1. 133 attempts, 164 min, 133 calls, 3.87M/445k.
5. Re-check of 35 accepted original proofs (final-heldout, tune-b-10x12, tune-d-simp, tune-d-simp-r2) against the library with Faithful.Chk: 35/35 still check.
6. cproofs-tune-abce: split + guide + Faithful.Chk + length facts (proposal, env-gated). proved 2/17 (clamp#1, factorial#4); equality 4, range 2. 131 attempts, 160 min, 131 calls, 4.17M/448k.
7. cproofs-tune-final-default: shipped defaults (split, guide, Chk, no length facts, stagnation stop). Running; see below.
Plan: per coordinator, TUNE near zero -> stop tuning; no held-out run; write PROOFS.md 'Candidate proofs'. Levers A, D, E not attempted (time-box).
8. cproofs-tune-final-default complete: proved 1/17 (clamp#1); equality parts 5, range parts 1. 131 attempts, 159 min, 131 calls, 4.21M/428k.
Decision: candidate proofs near zero on TUNE (1-2/17 vs baseline 1/17) -> stop tuning, no held-out run (gate in PROOFS.md). Defaults shipped: split + guide + Chk, length facts off.
