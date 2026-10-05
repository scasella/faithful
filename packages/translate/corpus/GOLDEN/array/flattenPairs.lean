import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def flattenPairs (pairs : List ((Int × Int))) : List (Int) :=
  (let init := ([] : List (Int));
   (List.foldl (fun (acc : List (Int)) (p : (Int × Int)) =>
       (acc ++ ([p.1, p.2] : List (Int)))) init pairs))

def flattenPairs_chk (pairs : List ((Int × Int))) : Faithful.Chk (List (Int)) :=
  do
    let init := ([] : List (Int))
    pure (List.foldl (fun (acc : List (Int)) (p : (Int × Int)) =>
              (acc ++ ([p.1, p.2] : List (Int)))) init pairs)

def flattenPairs_rangeOk (pairs : List ((Int × Int))) : Bool := Faithful.rangeOkOf (Model.flattenPairs_chk pairs)

def flattenPairs_pre (pairs : List ((Int × Int))) : Bool :=
  (((pairs).all (fun e0 => (Faithful.intOk e0.1) && (Faithful.intOk e0.2)))) && (Model.flattenPairs_rangeOk pairs)

end Model
