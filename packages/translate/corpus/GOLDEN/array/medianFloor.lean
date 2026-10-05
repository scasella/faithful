import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def medianFloor (xs : List (Int)) : Except String (Int) :=
  do
    if (((xs).length : Int) = (0 : Int)) then
      throw "median of empty array"
    else
      let sorted := (List.mergeSort (Faithful.sliceFrom xs (0 : Int)) (fun (a b : Int) => decide (a ≤ b)))
      let mid := (Int.fdiv ((sorted).length : Int) (2 : Int))
      if ((Int.tmod ((sorted).length : Int) (2 : Int)) = (1 : Int)) then
        pure (Faithful.getD sorted mid)
      else
        pure (Int.fdiv ((Faithful.getD sorted (mid - (1 : Int))) + (Faithful.getD sorted mid)) (2 : Int))

def medianFloor_chk (xs : List (Int)) : Faithful.Chk (Int) :=
  do
    if (((xs).length : Int) = (0 : Int)) then
      throw (Faithful.Fail.thrown "median of empty array")
    else
      let sorted := (List.mergeSort (Faithful.sliceFrom xs (0 : Int)) (fun (a b : Int) => decide (a ≤ b)))
      Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 16: Math.floor(sorted.length / 2)"
      let mid := (Int.fdiv ((sorted).length : Int) (2 : Int))
      Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 17: sorted.length % 2"
      if ((Int.tmod ((sorted).length : Int) (2 : Int)) = (1 : Int)) then
        Faithful.ck (Faithful.inBounds sorted mid) "bounds check failed at line 18: sorted[mid]"
        pure (Faithful.getD sorted mid)
      else
        Faithful.ck (Faithful.inRange (mid - (1 : Int))) "range check failed at line 20: mid - 1"
        Faithful.ck (Faithful.inBounds sorted (mid - (1 : Int))) "bounds check failed at line 20: sorted[mid - 1]"
        Faithful.ck (Faithful.inBounds sorted mid) "bounds check failed at line 20: sorted[mid]"
        Faithful.ck (Faithful.inRange ((Faithful.getD sorted (mid - (1 : Int))) + (Faithful.getD sorted mid))) "range check failed at line 20: sorted[mid - 1] + sorted[mid]"
        Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 20: Math.floor((sorted[mid - 1] + sorted[mid]) / 2)"
        pure (Int.fdiv ((Faithful.getD sorted (mid - (1 : Int))) + (Faithful.getD sorted mid)) (2 : Int))

def medianFloor_rangeOk (xs : List (Int)) : Bool := Faithful.rangeOkOf (Model.medianFloor_chk xs)

def medianFloor_pre (xs : List (Int)) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0))) && (Model.medianFloor_rangeOk xs)

end Model
