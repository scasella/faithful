import Faithful.Core
import Faithful.Simp
import Mathlib.Tactic.Linarith
import Mathlib.Tactic.Ring
import Mathlib.Tactic.NormNum
import Mathlib.Tactic.Positivity

/-!
# Faithful.Tactics: the slim tactic set proofs import

Proof files import this instead of `Mathlib` (docs/DESIGN.md, "Toolchain facts"): `linarith`, `ring`, `norm_num`,
`positivity`, plus `omega`/`decide`/`simp` from core, plus the `Faithful.Simp` rewriting lemmas about the runtime library
(docs/PROOFS.md). Never `import Mathlib`.
-/
