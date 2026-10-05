import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def intPow_loop1 (result : Int) (b : Int) (e : Int) : (Int × Int × Int) :=
  (if (e > (0 : Int)) then
    (let result_2 := (if ((Int.tmod e (2 : Int)) = (1 : Int)) then
          (let result_1 := (result * b);
           result_1)
         else
          result);
     (let b_1 := (b * b);
      (let e_1 := (Int.fdiv e (2 : Int));
       (Model.intPow_loop1 result_2 b_1 e_1))))
   else
    (result, b, e))
termination_by ((e - (0 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := e) (k := 2) (by omega) (by decide))
  faithful_decreasing

def intPow (base : Int) (exponent : Int) : Except String (Int) :=
  do
    if (exponent < (0 : Int)) then
      throw "negative exponent"
    else
      let result := (1 : Int)
      let b := base
      let e := exponent
      let (result_1, b_1, e_1) := (Model.intPow_loop1 result b e)
      pure result_1

def intPow_loop1_chk (result : Int) (b : Int) (e : Int) : Faithful.Chk ((Int × Int × Int)) :=
  do
    if (e > (0 : Int)) then
      let τ1 ← do
          Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 17: e % 2"
          if ((Int.tmod e (2 : Int)) = (1 : Int)) then
            Faithful.ck (Faithful.inRange (result * b)) "range check failed at line 18: result * b"
            let result_1 := (result * b)
            pure result_1
          else
            pure result
      let result_2 := τ1
      Faithful.ck (Faithful.inRange (b * b)) "range check failed at line 20: b * b"
      let b_1 := (b * b)
      Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 21: Math.floor(e / 2)"
      let e_1 := (Int.fdiv e (2 : Int))
      Model.intPow_loop1_chk result_2 b_1 e_1
    else
      pure (result, b, e)
termination_by ((e - (0 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := e) (k := 2) (by omega) (by decide))
  faithful_decreasing

def intPow_chk (base : Int) (exponent : Int) : Faithful.Chk (Int) :=
  do
    if (exponent < (0 : Int)) then
      throw (Faithful.Fail.thrown "negative exponent")
    else
      let result := (1 : Int)
      let b := base
      let e := exponent
      let τ1 ← Model.intPow_loop1_chk result b e
      let (result_1, b_1, e_1) := τ1
      pure result_1

def intPow_rangeOk (base : Int) (exponent : Int) : Bool := Faithful.rangeOkOf (Model.intPow_chk base exponent)

def intPow_pre (base : Int) (exponent : Int) : Bool :=
  ((Faithful.intOk base) && (Faithful.intOk exponent)) && (Model.intPow_rangeOk base exponent)

end Model
