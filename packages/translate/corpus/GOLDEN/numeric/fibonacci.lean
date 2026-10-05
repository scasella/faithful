import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def fibonacci_loop1 (n : Int) (a : Int) (b : Int) (i : Int) : (Int × Int × Int) :=
  (if (i < n) then
    (let next := (a + b);
     (let a_1 := b;
      (let b_1 := next;
       (let i_1 := (i + (1 : Int));
        (Model.fibonacci_loop1 n a_1 b_1 i_1)))))
   else
    (a, b, i))
termination_by ((n - i)).toNat
decreasing_by
  faithful_decreasing

def fibonacci (n : Int) : Except String (Int) :=
  do
    if (n < (0 : Int)) then
      throw "n must be non-negative"
    else
      let a := (0 : Int)
      let b := (1 : Int)
      let i := (0 : Int)
      let (a_1, b_1, i_1) := (Model.fibonacci_loop1 n a b i)
      pure a_1

def fibonacci_loop1_chk (n : Int) (a : Int) (b : Int) (i : Int) : Faithful.Chk ((Int × Int × Int)) :=
  do
    if (i < n) then
      Faithful.ck (Faithful.inRange (a + b)) "range check failed at line 15: a + b"
      let next := (a + b)
      let a_1 := b
      let b_1 := next
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 14: i++"
      let i_1 := (i + (1 : Int))
      Model.fibonacci_loop1_chk n a_1 b_1 i_1
    else
      pure (a, b, i)
termination_by ((n - i)).toNat
decreasing_by
  faithful_decreasing

def fibonacci_chk (n : Int) : Faithful.Chk (Int) :=
  do
    if (n < (0 : Int)) then
      throw (Faithful.Fail.thrown "n must be non-negative")
    else
      let a := (0 : Int)
      let b := (1 : Int)
      let i := (0 : Int)
      let τ1 ← Model.fibonacci_loop1_chk n a b i
      let (a_1, b_1, i_1) := τ1
      pure a_1

def fibonacci_rangeOk (n : Int) : Bool := Faithful.rangeOkOf (Model.fibonacci_chk n)

def fibonacci_pre (n : Int) : Bool :=
  ((Faithful.intOk n)) && (Model.fibonacci_rangeOk n)

end Model
