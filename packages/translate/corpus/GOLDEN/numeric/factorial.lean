import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def factorial_loop1 (n : Int) (result : Int) (i : Int) : (Int × Int) :=
  (if (i < (n + (1 : Int))) then
    (let result_1 := (result * i);
     (let i_1 := (i + (1 : Int));
      (Model.factorial_loop1 n result_1 i_1)))
   else
    (result, i))
termination_by (((n + (1 : Int)) - i)).toNat
decreasing_by
  faithful_decreasing

def factorial (n : Int) : Except String (Int) :=
  do
    if (n < (0 : Int)) then
      throw "factorial of a negative number"
    else
      let result := (1 : Int)
      let i := (2 : Int)
      let (result_1, i_1) := (Model.factorial_loop1 n result i)
      pure result_1

def factorial_loop1_chk (n : Int) (result : Int) (i : Int) : Faithful.Chk ((Int × Int)) :=
  do
    Faithful.ck (Faithful.inRange (n + (1 : Int))) "range check failed at line 13: n + 1"
    if (i < (n + (1 : Int))) then
      Faithful.ck (Faithful.inRange (result * i)) "range check failed at line 14: result * i"
      let result_1 := (result * i)
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 13: i++"
      let i_1 := (i + (1 : Int))
      Model.factorial_loop1_chk n result_1 i_1
    else
      pure (result, i)
termination_by (((n + (1 : Int)) - i)).toNat
decreasing_by
  faithful_decreasing

def factorial_chk (n : Int) : Faithful.Chk (Int) :=
  do
    if (n < (0 : Int)) then
      throw (Faithful.Fail.thrown "factorial of a negative number")
    else
      let result := (1 : Int)
      let i := (2 : Int)
      let τ1 ← Model.factorial_loop1_chk n result i
      let (result_1, i_1) := τ1
      pure result_1

def factorial_rangeOk (n : Int) : Bool := Faithful.rangeOkOf (Model.factorial_chk n)

def factorial_pre (n : Int) : Bool :=
  ((Faithful.intOk n)) && (Model.factorial_rangeOk n)

end Model
