import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def floorDivMod (a : Int) (b : Int) : Except String ((Int × Int)) :=
  do
    if (b = (0 : Int)) then
      throw "division by zero"
    else
      let q := (Int.fdiv a b)
      let r := (Int.tmod ((Int.tmod a b) + b) b)
      pure (q, r)

def floorDivMod_chk (a : Int) (b : Int) : Faithful.Chk ((Int × Int)) :=
  do
    if (b = (0 : Int)) then
      throw (Faithful.Fail.thrown "division by zero")
    else
      Faithful.ck (decide (b ≠ 0)) "nonzero check failed at line 13: Math.floor(a / b)"
      let q := (Int.fdiv a b)
      Faithful.ck (decide (b ≠ 0)) "nonzero check failed at line 14: a % b"
      Faithful.ck (Faithful.inRange ((Int.tmod a b) + b)) "range check failed at line 14: (a % b) + b"
      Faithful.ck (decide (b ≠ 0)) "nonzero check failed at line 14: ((a % b) + b) % b"
      let r := (Int.tmod ((Int.tmod a b) + b) b)
      pure (q, r)

def floorDivMod_rangeOk (a : Int) (b : Int) : Bool := Faithful.rangeOkOf (Model.floorDivMod_chk a b)

def floorDivMod_pre (a : Int) (b : Int) : Bool :=
  ((Faithful.intOk a) && (Faithful.intOk b)) && (Model.floorDivMod_rangeOk a b)

end Model
