import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def powerBySquaring (base : Int) (exponent : Int) : Except String (Int) :=
  do
    if (exponent < (0 : Int)) then
      throw "exponent must be non-negative"
    else
      if (exponent = (0 : Int)) then
        pure (1 : Int)
      else
        let τ1 ← Model.powerBySquaring base (Int.fdiv exponent (2 : Int))
        let half := τ1
        if ((Int.tmod exponent (2 : Int)) = (0 : Int)) then
          pure (half * half)
        else
          pure ((half * half) * base)
termination_by (((exponent - (1 : Int)) + (1 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := exponent) (k := 2) (by omega) (by decide))
  faithful_decreasing

def powerBySquaring_chkD (τd : Nat) (base : Int) (exponent : Int) : Faithful.Chk (Int) :=
  do
    if (exponent < (0 : Int)) then
      throw (Faithful.Fail.thrown "exponent must be non-negative")
    else
      if (exponent = (0 : Int)) then
        pure (1 : Int)
      else
        Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 16: Math.floor(exponent / 2)"
        Faithful.ck (decide (τd < 500)) "depth check failed at line 16: powerBySquaring(base, Math.floor(exponent / 2))"
        let τ1 ← Model.powerBySquaring_chkD (τd + 1) base (Int.fdiv exponent (2 : Int))
        let half := τ1
        Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 17: exponent % 2"
        if ((Int.tmod exponent (2 : Int)) = (0 : Int)) then
          Faithful.ck (Faithful.inRange (half * half)) "range check failed at line 18: half * half"
          pure (half * half)
        else
          Faithful.ck (Faithful.inRange (half * half)) "range check failed at line 20: half * half"
          Faithful.ck (Faithful.inRange ((half * half) * base)) "range check failed at line 20: half * half * base"
          pure ((half * half) * base)
termination_by (((exponent - (1 : Int)) + (1 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := exponent) (k := 2) (by omega) (by decide))
  faithful_decreasing

def powerBySquaring_chk (base : Int) (exponent : Int) : Faithful.Chk (Int) :=
  Model.powerBySquaring_chkD 1 base exponent

def powerBySquaring_rangeOk (base : Int) (exponent : Int) : Bool := Faithful.rangeOkOf (Model.powerBySquaring_chk base exponent)

def powerBySquaring_pre (base : Int) (exponent : Int) : Bool :=
  ((Faithful.intOk base) && (Faithful.intOk exponent)) && (Model.powerBySquaring_rangeOk base exponent)

end Model
