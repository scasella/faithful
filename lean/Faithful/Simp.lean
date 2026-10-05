import Faithful.Core

/-!
# Faithful.Simp: rewriting lemmas for proofs about generated models

Imported by `Faithful.Tactics` (the slim set proof files import), never by models or specs, so evaluation stays cheap and the
meaning of a model never depends on this file. Every lemma here is proved from the definitions in `Faithful.Core`
(no `sorry`, no new axioms; `lake build` checks it). They exist because the emitted models use `pure`/`throw` in
`Except`, the `Faithful.*` runtime functions, and `Int.fdiv`/`Int.tmod`, none of which Lean's default simp set rewrites
into the forms `omega` and the `List` library understand.

Normal forms chosen:
* `Except`: `pure a` ↦ `Except.ok a`, `throw e` ↦ `Except.error e`, `Except.ok a >>= f` ↦ `f a`, `Except.error e >>= f` ↦ `Except.error e`.
* integer division by a literal or non-negative divisor: `Int.fdiv a b` ↦ `a / b` (when `0 ≤ b`), `Int.tmod a b` ↦ `a % b`
  (when `0 ≤ a`; the side condition must be provable by `simp` from the hypotheses, e.g. `simp [*]` or `simp [h]`).
* reads with a non-negative index: `Faithful.getD xs i` ↦ `xs.getD i.toNat default`; `Faithful.getD xs ↑n` ↦ `xs.getD n default`.
* `Faithful.includes xs x = true` ↦ `x ∈ xs` (for types with lawful `==`).
* slices with non-negative bounds ↦ `List.drop`/`List.take`.
* `Faithful.inRange x = true` ↦ the two inequalities, so `omega` sees the bound.
-/

namespace Faithful

/-! ## Except -/

@[simp] theorem except_pure_eq_ok {ε α : Type} (a : α) : (pure a : Except ε α) = Except.ok a := rfl

@[simp] theorem except_throw_eq_error {ε α : Type} (e : ε) : (throw e : Except ε α) = Except.error e := rfl

@[simp] theorem except_ok_bind {ε α β : Type} (a : α) (f : α → Except ε β) : (Except.ok a >>= f) = f a := rfl

@[simp] theorem except_error_bind {ε α β : Type} (e : ε) (f : α → Except ε β) :
    (Except.error e >>= f) = (Except.error e : Except ε β) := rfl

@[simp] theorem except_ok_inj {ε α : Type} (a b : α) : (Except.ok a : Except ε α) = Except.ok b ↔ a = b :=
  ⟨fun h => (by cases h; rfl), fun h => h ▸ rfl⟩

@[simp] theorem except_error_inj {ε α : Type} (a b : ε) : (Except.error a : Except ε α) = Except.error b ↔ a = b :=
  ⟨fun h => (by cases h; rfl), fun h => h ▸ rfl⟩

@[simp] theorem except_ok_ne_error {ε α : Type} (a : α) (e : ε) : ((Except.ok a : Except ε α) = Except.error e) ↔ False :=
  ⟨fun h => (by cases h), False.elim⟩

@[simp] theorem except_error_ne_ok {ε α : Type} (a : α) (e : ε) : ((Except.error e : Except ε α) = Except.ok a) ↔ False :=
  ⟨fun h => (by cases h), False.elim⟩

/-! ## The checked twin (`rangeOk`) -/

@[simp] theorem ck_true (d : String) : ck true d = pure () := rfl

@[simp] theorem ck_false (d : String) : ck false d = throw (.range d) := rfl

@[simp] theorem rangeOkOf_ok {α : Type} (a : α) : rangeOkOf (Except.ok a : Chk α) = true := rfl

@[simp] theorem rangeOkOf_range {α : Type} (d : String) : rangeOkOf (Except.error (.range d) : Chk α) = false := rfl

@[simp] theorem rangeOkOf_thrown {α : Type} (m : String) : rangeOkOf (Except.error (.thrown m) : Chk α) = true := rfl

@[simp] theorem rangeOkOf_ascii {α : Type} (d : String) : rangeOkOf (Except.error (.ascii d) : Chk α) = true := rfl

/-! ## Integer bound -/

@[simp] theorem inRange_eq_true (x : Int) :
    inRange x = true ↔ -9007199254740992 ≤ x ∧ x ≤ 9007199254740992 := by
  unfold inRange MAX; exact decide_eq_true_iff

/-! ## Arithmetic helpers -/

@[simp] theorem fdiv_of_nonneg {a b : Int} (hb : 0 ≤ b) : Int.fdiv a b = a / b :=
  Int.fdiv_eq_ediv_of_nonneg a hb

@[simp] theorem tmod_of_nonneg {a b : Int} (ha : 0 ≤ a) : Int.tmod a b = a % b :=
  Int.tmod_eq_emod_of_nonneg ha

theorem iabs_eq (x : Int) : iabs x = if 0 ≤ x then x else -x := by
  unfold iabs; split <;> omega

@[simp] theorem iabs_toNat (x : Int) : (iabs x).toNat = x.natAbs := by
  unfold iabs; omega

theorem iabs_nonneg (x : Int) : 0 ≤ iabs x := by
  unfold iabs; omega

theorem cdiv_eq (a b : Int) : cdiv a b = -(Int.fdiv (-a) b) := rfl

/-! ## Total reads -/

theorem getD_of_nonneg {α : Type} [Inhabited α] (xs : List α) {i : Int} (hi : 0 ≤ i) :
    getD xs i = xs.getD i.toNat default := by
  unfold getD; simp [show ¬ i < 0 by omega]

@[simp] theorem getD_natCast {α : Type} [Inhabited α] (xs : List α) (n : Nat) :
    getD xs (n : Int) = xs.getD n default := by
  unfold getD; simp only [show ¬ (n : Int) < 0 by omega, ite_false, Int.toNat_natCast]

theorem getD_of_neg {α : Type} [Inhabited α] (xs : List α) {i : Int} (hi : i < 0) : getD xs i = default := by
  unfold getD; simp [hi]

@[simp] theorem inBounds_eq_true {α : Type} (xs : List α) (i : Int) :
    inBounds xs i = true ↔ 0 ≤ i ∧ i < (xs.length : Int) := by
  simp [inBounds]

/-! ## Search -/

@[simp] theorem includes_eq_true {α : Type} [BEq α] [LawfulBEq α] (xs : List α) (x : α) :
    includes xs x = true ↔ x ∈ xs := by
  simp [includes]

@[simp] theorem includes_nil {α : Type} [BEq α] (x : α) : includes [] x = false := rfl

theorem includes_cons {α : Type} [BEq α] (y : α) (ys : List α) (x : α) :
    includes (y :: ys) x = (y == x || includes ys x) := rfl

/-! ## Slicing -/

theorem slice_of_nonneg {α : Type} (xs : List α) {a b : Int} (ha : 0 ≤ a) (hb : 0 ≤ b) :
    slice xs a b = (xs.drop a.toNat).take (b - a).toNat := by
  unfold slice sliceIdx
  simp only [show ¬ a < 0 by omega, show ¬ b < 0 by omega, ite_false]
  by_cases hal : a ≤ (xs.length : Int)
  · have h1 : (min a (xs.length : Int)).toNat = a.toNat := by omega
    rw [h1]
    apply List.ext_getElem
    · simp only [List.length_take, List.length_drop]; omega
    · intro n h1 h2
      simp only [List.getElem_take, List.getElem_drop]
  · have h1 : xs.length ≤ a.toNat := by omega
    have h2 : xs.length ≤ (min a (xs.length : Int)).toNat := by omega
    simp [List.drop_of_length_le h1, List.drop_of_length_le h2]

@[simp] theorem slice_zero {α : Type} (xs : List α) {b : Int} (hb : 0 ≤ b) : slice xs 0 b = xs.take b.toNat := by
  rw [slice_of_nonneg xs (Int.le_refl 0) hb]; simp

theorem sliceFrom_of_nonneg {α : Type} (xs : List α) {a : Int} (ha : 0 ≤ a) : sliceFrom xs a = xs.drop a.toNat := by
  unfold sliceFrom
  rw [slice_of_nonneg xs ha (by omega)]
  apply List.take_of_length_le
  simp only [List.length_drop]; omega

/-! ## Strings -/

theorem charAt_of_lt (s : List Char) {i : Int} (h0 : 0 ≤ i) (h1 : i < (s.length : Int)) :
    charAt s i = [s.getD i.toNat 'a'] := by
  unfold charAt; simp [h0, h1]

theorem charAt_of_not_lt (s : List Char) {i : Int} (h : ¬ (0 ≤ i ∧ i < (s.length : Int))) : charAt s i = [] := by
  unfold charAt; simp only [h, ite_false]

/-! ## Folds -/

/-- The emitted form of `xs.reduce((a, x) => a + x, init)` as a sum. -/
theorem foldl_add_eq (xs : List Int) (a : Int) : List.foldl (fun acc x => acc + x) a xs = a + xs.sum := by
  induction xs generalizing a with
  | nil => simp
  | cons x xs ih => simp [ih]; omega

end Faithful
