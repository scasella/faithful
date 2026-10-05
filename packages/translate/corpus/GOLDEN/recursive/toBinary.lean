import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def toBinary (n : Int) : Except String (List Char) :=
  do
    if (n < (0 : Int)) then
      throw "toBinary expects a non-negative integer"
    else
      if (n < (2 : Int)) then
        if (n = (0 : Int)) then
          pure ['0']
        else
          pure ['1']
      else
        let bit := (if ((Int.tmod n (2 : Int)) = (0 : Int)) then
                ['0']
               else
                ['1'])
        let τ1 ← Model.toBinary (Int.fdiv n (2 : Int))
        pure (τ1 ++ bit)
termination_by (((n - (2 : Int)) + (1 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := n) (k := 2) (by omega) (by decide))
  faithful_decreasing

def toBinary_chkD (τd : Nat) (n : Int) : Faithful.Chk (List Char) :=
  do
    if (n < (0 : Int)) then
      throw (Faithful.Fail.thrown "toBinary expects a non-negative integer")
    else
      if (n < (2 : Int)) then
        if (n = (0 : Int)) then
          pure ['0']
        else
          pure ['1']
      else
        Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 16: n % 2"
        let bit := (if ((Int.tmod n (2 : Int)) = (0 : Int)) then
                ['0']
               else
                ['1'])
        Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 17: Math.floor(n / 2)"
        Faithful.ck (decide (τd < 500)) "depth check failed at line 17: toBinary(Math.floor(n / 2))"
        let τ1 ← Model.toBinary_chkD (τd + 1) (Int.fdiv n (2 : Int))
        Faithful.ck (decide (((τ1 ++ bit)).length ≤ 16777216)) "length check failed at line 17: toBinary(Math.floor(n / 2)) + bit"
        pure (τ1 ++ bit)
termination_by (((n - (2 : Int)) + (1 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := n) (k := 2) (by omega) (by decide))
  faithful_decreasing

def toBinary_chk (n : Int) : Faithful.Chk (List Char) :=
  Model.toBinary_chkD 1 n

def toBinary_rangeOk (n : Int) : Bool := Faithful.rangeOkOf (Model.toBinary_chk n)

def toBinary_pre (n : Int) : Bool :=
  ((Faithful.intOk n)) && (Model.toBinary_rangeOk n)

end Model
