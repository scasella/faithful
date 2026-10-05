import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def sum (xs : List (Int)) : Int :=
  (List.foldl (fun (acc : Int) (x : Int) =>
      (acc + x)) (0 : Int) xs)

def sum_chk (xs : List (Int)) : Faithful.Chk (Int) :=
  do
    let τ1 ← List.foldlM (fun (acc : Int) (x : Int) => do
          Faithful.ck (Faithful.inRange (acc + x)) "range check failed at line 8: acc + x"
          pure (acc + x)) (0 : Int) xs
    pure τ1

def sum_rangeOk (xs : List (Int)) : Bool := Faithful.rangeOkOf (Model.sum_chk xs)

def sum_pre (xs : List (Int)) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0))) && (Model.sum_rangeOk xs)

end Model
