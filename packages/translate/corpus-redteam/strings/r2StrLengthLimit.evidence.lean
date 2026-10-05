-- Red-team round 2, strings: evidence for r2StrLengthLimit.ts (status=divergence).
-- The model below is translate() output for that probe on 2026-10-05; the theorem shows Model.f_pre ['a'] = true
-- (no sorry: axioms propext, Classical.choice, Quot.sound), while Node v25.8.1 throws RangeError: Invalid string length
-- on f("a") (V8 max string length 2^29 - 24). Check: cd lean && lake env lean <this file>.
import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def f_loop1 (t : List Char) (i : Int) : (List Char × Int) :=
  (if (i < (30 : Int)) then
    (let t_1 := (t ++ t);
     (let i_1 := (i + (1 : Int));
      (Model.f_loop1 t_1 i_1)))
   else
    (t, i))
termination_by (((30 : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def f (s : List Char) : Int :=
  (let t := s;
   (let i := (0 : Int);
    (let (t_1, i_1) := (Model.f_loop1 t i);
     ((t_1).length : Int))))

def f_loop1_chk (t : List Char) (i : Int) : Faithful.Chk ((List Char × Int)) :=
  do
    if (i < (30 : Int)) then
      let t_1 := (t ++ t)
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 7: i++"
      let i_1 := (i + (1 : Int))
      Model.f_loop1_chk t_1 i_1
    else
      pure (t, i)
termination_by (((30 : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def f_chk (s : List Char) : Faithful.Chk (Int) :=
  do
    let t := s
    let i := (0 : Int)
    let τ1 ← Model.f_loop1_chk t i
    let (t_1, i_1) := τ1
    pure ((t_1).length : Int)

def f_rangeOk (s : List Char) : Bool := Faithful.rangeOkOf (Model.f_chk s)

def f_pre (s : List Char) : Bool :=
  ((Faithful.bmp s)) && (Model.f_rangeOk s)


theorem loop_ok : ∀ (n : Nat) (t : List Char) (i : Int), (30 - i).toNat = n → 0 ≤ i →
    ∃ v, Model.f_loop1_chk t i = Except.ok v := by
  intro n
  induction n with
  | zero =>
    intro t i hn hi
    rw [Model.f_loop1_chk]
    have : ¬ (i < 30) := by omega
    simp only [this, if_false]
    exact ⟨(t, i), rfl⟩
  | succ k ih =>
    intro t i hn hi
    rw [Model.f_loop1_chk]
    have h1 : i < 30 := by omega
    have h2 : Faithful.inRange (i + 1) = true := by
      unfold Faithful.inRange Faithful.MAX; exact decide_eq_true (by omega)
    simp only [h1, if_true, Faithful.ck, h2]
    obtain ⟨v, hv⟩ := ih (t ++ t) (i + 1) (by omega) (by omega)
    exact ⟨v, by simp [hv]⟩

theorem pre_true_on_a : Model.f_pre ['a'] = true := by
  obtain ⟨v, hv⟩ := loop_ok 30 ['a'] 0 (by decide) (by decide)
  simp [Model.f_pre, Model.f_rangeOk, Model.f_chk, Faithful.rangeOkOf, Faithful.bmp, hv]
  rfl

#print axioms pre_true_on_a
end Model
