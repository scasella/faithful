import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def sumOddSquares (xs : List (Int)) : Int :=
  (List.foldl (fun (acc : Int) (x_2 : Int) =>
      (acc + x_2)) (0 : Int) (List.map (fun (x_1 : Int) =>
        (x_1 * x_1)) (List.filter (fun (x : Int) =>
          (decide ((Int.tmod x (2 : Int)) = (1 : Int)))) xs)))

def sumOddSquares_chk (xs : List (Int)) : Faithful.Chk (Int) :=
  do
    let τ1 ← List.filterM (fun (x : Int) => do
          Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 9: x % 2"
          pure (decide ((Int.tmod x (2 : Int)) = (1 : Int)))) xs
    let τ2 ← List.mapM (fun (x_1 : Int) => do
          Faithful.ck (Faithful.inRange (x_1 * x_1)) "range check failed at line 10: x * x"
          pure (x_1 * x_1)) τ1
    let τ3 ← List.foldlM (fun (acc : Int) (x_2 : Int) => do
          Faithful.ck (Faithful.inRange (acc + x_2)) "range check failed at line 11: acc + x"
          pure (acc + x_2)) (0 : Int) τ2
    pure τ3

def sumOddSquares_rangeOk (xs : List (Int)) : Bool := Faithful.rangeOkOf (Model.sumOddSquares_chk xs)

def sumOddSquares_pre (xs : List (Int)) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0))) && (Model.sumOddSquares_rangeOk xs)

end Model
