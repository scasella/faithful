import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def flattenPairs (pairs : List ((Int × Int))) : List (Int) :=
  (if (((pairs).length : Int) = (0 : Int)) then
    ([] : List (Int))
   else
    (let head := (Faithful.getD pairs (0 : Int));
     (([head.1, head.2] : List (Int)) ++ (Model.flattenPairs (Faithful.sliceFrom pairs (1 : Int))))))
termination_by pairs.length
decreasing_by
  all_goals (try have := Faithful.sliceFrom_length_lt pairs (k := 1) (by omega) (by faithful_len_pos))
  faithful_decreasing

def flattenPairs_chkD (τd : Nat) (pairs : List ((Int × Int))) : Faithful.Chk (List (Int)) :=
  do
    if (((pairs).length : Int) = (0 : Int)) then
      pure ([] : List (Int))
    else
      Faithful.ck (Faithful.inBounds pairs (0 : Int)) "bounds check failed at line 12: pairs[0]"
      let head := (Faithful.getD pairs (0 : Int))
      Faithful.ck (decide (τd < 500)) "depth check failed at line 13: flattenPairs(pairs.slice(1))"
      let τ1 ← Model.flattenPairs_chkD (τd + 1) (Faithful.sliceFrom pairs (1 : Int))
      pure (([head.1, head.2] : List (Int)) ++ τ1)
termination_by pairs.length
decreasing_by
  all_goals (try have := Faithful.sliceFrom_length_lt pairs (k := 1) (by omega) (by faithful_len_pos))
  faithful_decreasing

def flattenPairs_chk (pairs : List ((Int × Int))) : Faithful.Chk (List (Int)) :=
  Model.flattenPairs_chkD 1 pairs

def flattenPairs_rangeOk (pairs : List ((Int × Int))) : Bool := Faithful.rangeOkOf (Model.flattenPairs_chk pairs)

def flattenPairs_pre (pairs : List ((Int × Int))) : Bool :=
  (((pairs).all (fun e0 => (Faithful.intOk e0.1) && (Faithful.intOk e0.2)))) && (Model.flattenPairs_rangeOk pairs)

end Model
