import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def reverseDigits (n : Int) (acc : Int) : Except String (Int) :=
  do
    if (n < (0 : Int)) then
      throw "reverseDigits expects a non-negative integer"
    else
      if (n = (0 : Int)) then
        pure acc
      else
        Model.reverseDigits (Int.fdiv n (10 : Int)) ((acc * (10 : Int)) + (Int.tmod n (10 : Int)))
termination_by (((n - (1 : Int)) + (1 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := n) (k := 10) (by omega) (by decide))
  faithful_decreasing

def reverseDigits_chkD (τd : Nat) (n : Int) (acc : Int) : Faithful.Chk (Int) :=
  do
    if (n < (0 : Int)) then
      throw (Faithful.Fail.thrown "reverseDigits expects a non-negative integer")
    else
      if (n = (0 : Int)) then
        pure acc
      else
        Faithful.ck (decide ((10 : Int) ≠ 0)) "nonzero check failed at line 16: Math.floor(n / 10)"
        Faithful.ck (Faithful.inRange (acc * (10 : Int))) "range check failed at line 16: acc * 10"
        Faithful.ck (decide ((10 : Int) ≠ 0)) "nonzero check failed at line 16: n % 10"
        Faithful.ck (Faithful.inRange ((acc * (10 : Int)) + (Int.tmod n (10 : Int)))) "range check failed at line 16: acc * 10 + (n % 10)"
        Faithful.ck (decide (τd < 500)) "depth check failed at line 16: reverseDigits(Math.floor(n / 10), acc * 10 + (n % 10))"
        Model.reverseDigits_chkD (τd + 1) (Int.fdiv n (10 : Int)) ((acc * (10 : Int)) + (Int.tmod n (10 : Int)))
termination_by (((n - (1 : Int)) + (1 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := n) (k := 10) (by omega) (by decide))
  faithful_decreasing

def reverseDigits_chk (n : Int) (acc : Int) : Faithful.Chk (Int) :=
  Model.reverseDigits_chkD 1 n acc

def reverseDigits_rangeOk (n : Int) (acc : Int) : Bool := Faithful.rangeOkOf (Model.reverseDigits_chk n acc)

def reverseDigits_pre (n : Int) (acc : Int) : Bool :=
  ((Faithful.intOk n) && (Faithful.intOk acc)) && (Model.reverseDigits_rangeOk n acc)

end Model
