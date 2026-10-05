import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def maxSubarraySum_loop1 (xs : List (Int)) (best : Int) (cur : Int) (i : Int) : (Int × Int × Int) :=
  (if (i < ((xs).length : Int)) then
    (let cur_1 := (Max.max (Faithful.getD xs i) (cur + (Faithful.getD xs i)));
     (let best_1 := (Max.max best cur_1);
      (let i_1 := (i + (1 : Int));
       (Model.maxSubarraySum_loop1 xs best_1 cur_1 i_1))))
   else
    (best, cur, i))
termination_by ((((xs).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def maxSubarraySum (xs : List (Int)) : Except String (Int) :=
  do
    if (((xs).length : Int) = (0 : Int)) then
      throw "empty input"
    else
      let best := (Faithful.getD xs (0 : Int))
      let cur := (Faithful.getD xs (0 : Int))
      let i := (1 : Int)
      let (best_1, cur_1, i_1) := (Model.maxSubarraySum_loop1 xs best cur i)
      pure best_1

def maxSubarraySum_loop1_chk (xs : List (Int)) (best : Int) (cur : Int) (i : Int) : Faithful.Chk ((Int × Int × Int)) :=
  do
    if (i < ((xs).length : Int)) then
      Faithful.ck (Faithful.inBounds xs i) "bounds check failed at line 17: xs[i]"
      Faithful.ck (Faithful.inBounds xs i) "bounds check failed at line 17: xs[i]"
      Faithful.ck (Faithful.inRange (cur + (Faithful.getD xs i))) "range check failed at line 17: cur + xs[i]"
      let cur_1 := (Max.max (Faithful.getD xs i) (cur + (Faithful.getD xs i)))
      let best_1 := (Max.max best cur_1)
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 16: i++"
      let i_1 := (i + (1 : Int))
      Model.maxSubarraySum_loop1_chk xs best_1 cur_1 i_1
    else
      pure (best, cur, i)
termination_by ((((xs).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def maxSubarraySum_chk (xs : List (Int)) : Faithful.Chk (Int) :=
  do
    if (((xs).length : Int) = (0 : Int)) then
      throw (Faithful.Fail.thrown "empty input")
    else
      Faithful.ck (Faithful.inBounds xs (0 : Int)) "bounds check failed at line 14: xs[0]"
      let best := (Faithful.getD xs (0 : Int))
      Faithful.ck (Faithful.inBounds xs (0 : Int)) "bounds check failed at line 15: xs[0]"
      let cur := (Faithful.getD xs (0 : Int))
      let i := (1 : Int)
      let τ1 ← Model.maxSubarraySum_loop1_chk xs best cur i
      let (best_1, cur_1, i_1) := τ1
      pure best_1

def maxSubarraySum_rangeOk (xs : List (Int)) : Bool := Faithful.rangeOkOf (Model.maxSubarraySum_chk xs)

def maxSubarraySum_pre (xs : List (Int)) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0))) && (Model.maxSubarraySum_rangeOk xs)

end Model
