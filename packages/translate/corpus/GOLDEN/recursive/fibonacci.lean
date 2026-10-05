import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def fibonacci (n : Int) : Except String (Int) :=
  do
    if (n < (0 : Int)) then
      throw "n must be non-negative"
    else
      if (n < (2 : Int)) then
        pure n
      else
        let τ1 ← Model.fibonacci (n - (1 : Int))
        let τ2 ← Model.fibonacci (n - (2 : Int))
        pure (τ1 + τ2)
termination_by (((n - (2 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def fibonacci_chkD (τd : Nat) (n : Int) : Faithful.Chk (Int) :=
  do
    if (n < (0 : Int)) then
      throw (Faithful.Fail.thrown "n must be non-negative")
    else
      if (n < (2 : Int)) then
        pure n
      else
        Faithful.ck (Faithful.inRange (n - (1 : Int))) "range check failed at line 16: n - 1"
        Faithful.ck (decide (τd < 500)) "depth check failed at line 16: fibonacci(n - 1)"
        let τ1 ← Model.fibonacci_chkD (τd + 1) (n - (1 : Int))
        Faithful.ck (Faithful.inRange (n - (2 : Int))) "range check failed at line 16: n - 2"
        Faithful.ck (decide (τd < 500)) "depth check failed at line 16: fibonacci(n - 2)"
        let τ2 ← Model.fibonacci_chkD (τd + 1) (n - (2 : Int))
        Faithful.ck (Faithful.inRange (τ1 + τ2)) "range check failed at line 16: fibonacci(n - 1) + fibonacci(n - 2)"
        pure (τ1 + τ2)
termination_by (((n - (2 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def fibonacci_chk (n : Int) : Faithful.Chk (Int) :=
  Model.fibonacci_chkD 1 n

def fibonacci_rangeOk (n : Int) : Bool := Faithful.rangeOkOf (Model.fibonacci_chk n)

def fibonacci_pre (n : Int) : Bool :=
  ((Faithful.intOk n)) && (Model.fibonacci_rangeOk n)

end Model
