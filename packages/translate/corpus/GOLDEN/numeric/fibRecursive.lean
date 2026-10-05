import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def fibRecursive (n : Int) : Int :=
  (if (n < (2 : Int)) then
    n
   else
    ((Model.fibRecursive (n - (1 : Int))) + (Model.fibRecursive (n - (2 : Int)))))
termination_by (((n - (2 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def fibRecursive_chkD (τd : Nat) (n : Int) : Faithful.Chk (Int) :=
  do
    if (n < (2 : Int)) then
      pure n
    else
      Faithful.ck (Faithful.inRange (n - (1 : Int))) "range check failed at line 11: n - 1"
      Faithful.ck (decide (τd < 500)) "depth check failed at line 11: fibRecursive(n - 1)"
      let τ1 ← Model.fibRecursive_chkD (τd + 1) (n - (1 : Int))
      Faithful.ck (Faithful.inRange (n - (2 : Int))) "range check failed at line 11: n - 2"
      Faithful.ck (decide (τd < 500)) "depth check failed at line 11: fibRecursive(n - 2)"
      let τ2 ← Model.fibRecursive_chkD (τd + 1) (n - (2 : Int))
      Faithful.ck (Faithful.inRange (τ1 + τ2)) "range check failed at line 11: fibRecursive(n - 1) + fibRecursive(n - 2)"
      pure (τ1 + τ2)
termination_by (((n - (2 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def fibRecursive_chk (n : Int) : Faithful.Chk (Int) :=
  Model.fibRecursive_chkD 1 n

def fibRecursive_rangeOk (n : Int) : Bool := Faithful.rangeOkOf (Model.fibRecursive_chk n)

def fibRecursive_pre (n : Int) : Bool :=
  ((Faithful.intOk n)) && (Model.fibRecursive_rangeOk n)

end Model
