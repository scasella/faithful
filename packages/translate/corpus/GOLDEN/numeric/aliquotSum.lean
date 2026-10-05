import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def aliquotSum_loop1 (n : Int) (sum : Int) (i : Int) : (Int × Int) :=
  (if (i < n) then
    (let sum_2 := (if ((Int.tmod n i) = (0 : Int)) then
          (let sum_1 := (sum + i);
           sum_1)
         else
          sum);
     (let i_1 := (i + (1 : Int));
      (Model.aliquotSum_loop1 n sum_2 i_1)))
   else
    (sum, i))
termination_by ((n - i)).toNat
decreasing_by
  faithful_decreasing

def aliquotSum (n : Int) : Int :=
  (let sum := (0 : Int);
   (let i := (1 : Int);
    (let (sum_1, i_1) := (Model.aliquotSum_loop1 n sum i);
     sum_1)))

def aliquotSum_loop1_chk (n : Int) (sum : Int) (i : Int) : Faithful.Chk ((Int × Int)) :=
  do
    if (i < n) then
      let τ1 ← do
          Faithful.ck (decide (i ≠ 0)) "nonzero check failed at line 12: n % i"
          if ((Int.tmod n i) = (0 : Int)) then
            Faithful.ck (Faithful.inRange (sum + i)) "range check failed at line 13: sum + i"
            let sum_1 := (sum + i)
            pure sum_1
          else
            pure sum
      let sum_2 := τ1
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 11: i++"
      let i_1 := (i + (1 : Int))
      Model.aliquotSum_loop1_chk n sum_2 i_1
    else
      pure (sum, i)
termination_by ((n - i)).toNat
decreasing_by
  faithful_decreasing

def aliquotSum_chk (n : Int) : Faithful.Chk (Int) :=
  do
    let sum := (0 : Int)
    let i := (1 : Int)
    let τ1 ← Model.aliquotSum_loop1_chk n sum i
    let (sum_1, i_1) := τ1
    pure sum_1

def aliquotSum_rangeOk (n : Int) : Bool := Faithful.rangeOkOf (Model.aliquotSum_chk n)

def aliquotSum_pre (n : Int) : Bool :=
  ((Faithful.intOk n)) && (Model.aliquotSum_rangeOk n)

end Model
