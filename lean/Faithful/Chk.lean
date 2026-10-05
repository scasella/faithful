import Faithful.Simp

/-!
# Faithful.Chk: lemmas about the checked twin (`rangeOk`) for candidate proofs

Imported by `Faithful.Tactics` (never by models or specs). Every lemma is proved from the definitions in `Faithful.Core`
(no `sorry`, no new axioms; `lake build` checks it). Added for the candidate-proof work (docs/PROOFS.md, "Candidate
proofs"): the range part of a candidate proof reads a passing run of the ORIGINAL's checked twin (its precondition) and
builds a passing run of the CANDIDATE's.
-/

namespace Faithful

/-! ## The checked twin, continued (candidate proofs: docs/PROOFS.md, "Candidate proofs")

The checked twin `f_chk` is a `do` block in `Chk = Except Fail`: `Faithful.ck (Faithful.inRange e) "..."` before every
operation that must stay inside the model, then the same computation as the model. `rangeOkOf r = true` says the run did not
stop with `.range`. These lemmas read a passing run (the original's precondition) and build one (the candidate's). -/

theorem ck_eq (b : Bool) (d : String) : ck b d = if b = true then Except.ok () else Except.error (.range d) := by
  cases b <;> rfl

@[simp] theorem rangeOkOf_pure {α : Type} (a : α) : rangeOkOf (pure a : Chk α) = true := rfl

/-- One check followed by the rest of the run: the check passes and the rest passes. -/
@[simp] theorem rangeOkOf_ck_bind {β : Type} (b : Bool) (d : String) (f : Unit → Chk β) :
    rangeOkOf (ck b d >>= f) = (b && rangeOkOf (f ())) := by
  cases b <;> rfl

/-- `simp` writes `ck b d >>= fun _ => pure v` as `(fun _ => v) <$> ck b d`. -/
@[simp] theorem rangeOkOf_map {α β : Type} (f : α → β) (x : Chk α) : rangeOkOf (f <$> x) = rangeOkOf x := by
  cases x with
  | ok a => rfl
  | error e => cases e <;> rfl

theorem rangeOkOf_of_eq_ok {α : Type} {r : Chk α} {a : α} (h : r = Except.ok a) : rangeOkOf r = true := by
  subst h; rfl

theorem rangeOkOf_eq_true_iff {α : Type} (r : Chk α) : rangeOkOf r = true ↔ ∀ d, r ≠ Except.error (.range d) := by
  cases r with
  | ok a => simp [rangeOkOf]
  | error e => cases e <;> simp [rangeOkOf]

/-- After a step that returned `.ok a`, the run passes iff the rest (from `a`) passes. -/
theorem rangeOkOf_bind_of_eq_ok {α β : Type} {x : Chk α} {a : α} (h : x = Except.ok a) (f : α → Chk β) :
    rangeOkOf (x >>= f) = rangeOkOf (f a) := by
  subst h; rfl

/-- A passing run passed its first step (a sub-run, e.g. a loop's checked twin, that stops with `.range` stops the run). -/
theorem rangeOkOf_of_bind {α β : Type} (x : Chk α) (f : α → Chk β) (h : rangeOkOf (x >>= f) = true) :
    rangeOkOf x = true := by
  cases x with
  | ok a => rfl
  | error e => cases e <;> first | rfl | exact h

theorem bind_eq_ok_iff {ε α β : Type} (x : Except ε α) (f : α → Except ε β) (b : β) :
    (x >>= f) = Except.ok b ↔ ∃ a, x = Except.ok a ∧ f a = Except.ok b := by
  cases x with
  | error e => simp [bind, Except.bind]
  | ok a => simp [bind, Except.bind]

theorem ck_bind_eq_ok_iff {β : Type} (b : Bool) (d : String) (f : Unit → Chk β) (v : β) :
    (ck b d >>= f) = Except.ok v ↔ b = true ∧ f () = Except.ok v := by
  cases b <;> simp [ck, bind, Except.bind, pure, Except.pure, throw, throwThe, MonadExceptOf.throw]

/-- `rangeOkOf` of a run that ended with a `Chk` value which is not a range failure. -/
theorem rangeOkOf_thrown_or_ok {α : Type} (r : Chk α) (h : ∀ d, r ≠ Except.error (.range d)) : rangeOkOf r = true :=
  (rangeOkOf_eq_true_iff r).2 h

/-! ## Index loops over a list

A candidate often replaces `for (const x of xs)` (a recursion on the list, or a fold) by `for (let i = ...; i < xs.length; i++)`
reading `xs[i]` (`Faithful.getD xs i`). State the index loop's invariant over the unvisited suffix `xs.drop i.toNat`, and
step it with these. -/

theorem drop_eq_getD_cons {α : Type} [Inhabited α] (xs : List α) {i : Int} (h0 : 0 ≤ i) (h1 : i < (xs.length : Int)) :
    xs.drop i.toNat = getD xs i :: xs.drop (i + 1).toNat := by
  have hlt : i.toNat < xs.length := by omega
  rw [getD_of_nonneg xs h0, show (i + 1).toNat = i.toNat + 1 by omega]
  rw [List.drop_eq_getElem_cons hlt]
  simp [List.getD_eq_getElem?_getD, List.getElem?_eq_getElem hlt]

theorem drop_toNat_of_length_le {α : Type} (xs : List α) {i : Int} (h : (xs.length : Int) ≤ i) : xs.drop i.toNat = [] := by
  apply List.drop_of_length_le; omega

theorem foldl_drop_step {α β : Type} [Inhabited α] (f : β → α → β) (b : β) (xs : List α) {i : Int} (h0 : 0 ≤ i)
    (h1 : i < (xs.length : Int)) :
    (xs.drop i.toNat).foldl f b = (xs.drop (i + 1).toNat).foldl f (f b (getD xs i)) := by
  rw [drop_eq_getD_cons xs h0 h1, List.foldl_cons]

/-! ## Character codes (`s.charCodeAt(i)` against `s.charAt(i)` / `s[i]` comparisons) -/

@[simp] theorem char_toNat_cast_inj (a b : Char) : ((a.toNat : Int) = (b.toNat : Int)) ↔ a = b := by
  constructor
  · intro h
    have h' : a.toNat = b.toNat := by omega
    exact Char.toNat_inj.mp h'
  · intro h; subst h; rfl

theorem charCodeAt_of_lt (s : List Char) {i : Int} (h0 : 0 ≤ i) (h1 : i < (s.length : Int)) :
    charCodeAt s i = ((getD s i).toNat : Int) := by
  unfold charCodeAt; simp [h0, h1]

theorem charCodeAt_eq_iff (s t : List Char) {i j : Int} (h0 : 0 ≤ i) (h1 : i < (s.length : Int)) (h2 : 0 ≤ j)
    (h3 : j < (t.length : Int)) : charCodeAt s i = charCodeAt t j ↔ getD s i = getD t j := by
  rw [charCodeAt_of_lt s h0 h1, charCodeAt_of_lt t h2 h3, char_toNat_cast_inj]

end Faithful
