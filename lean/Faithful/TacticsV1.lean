import Faithful.Core
import Faithful.Simp
import Mathlib.Tactic.Linarith
import Mathlib.Tactic.Ring
import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Positivity

/-!
# Faithful.TacticsV1: the tactic set as it was before `Faithful.Chk`

Used only by `scripts/candidate-proofs.mjs --lib v1` to reproduce the candidate-proof baseline (docs/PROOFS.md,
"Candidate proofs"). Proof files of the product import `Faithful.Tactics`.

(Original header: the slim tactic set proofs import)

Proof files import this instead of `Mathlib` (docs/DESIGN.md, "Toolchain facts"): `linarith`, `ring`, `norm_num`,
`positivity`, plus `omega`/`decide`/`simp` from core, plus the `Faithful.Simp` rewriting lemmas about the runtime library
(docs/PROOFS.md). Never `import Mathlib`.
-/
