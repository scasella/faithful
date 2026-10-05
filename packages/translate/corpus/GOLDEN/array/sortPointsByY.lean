import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

structure Rec1 where
  x : Int
  y : Int
  deriving Repr, Inhabited

instance : Lean.ToJson Rec1 := ⟨fun r => Lean.Json.mkObj [("x", Faithful.jInt r.x), ("y", Faithful.jInt r.y)]⟩

def sortPointsByY (points : List (Model.Rec1)) : List (Model.Rec1) :=
  (List.mergeSort (Faithful.sliceFrom points (0 : Int)) (fun (a b : Model.Rec1) => decide (a.y ≤ b.y)))

def sortPointsByY_chk (points : List (Model.Rec1)) : Faithful.Chk (List (Model.Rec1)) :=
  do
    pure (List.mergeSort (Faithful.sliceFrom points (0 : Int)) (fun (a b : Model.Rec1) => decide (a.y ≤ b.y)))

def sortPointsByY_rangeOk (points : List (Model.Rec1)) : Bool := Faithful.rangeOkOf (Model.sortPointsByY_chk points)

def sortPointsByY_pre (points : List (Model.Rec1)) : Bool :=
  (((points).all (fun e0 => (Faithful.intOk e0.x) && (Faithful.intOk e0.y)))) && (Model.sortPointsByY_rangeOk points)

end Model
