import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def reverseArray_loop1 (xs : List (List Char)) (out : List (List Char)) (i : Int) : (List (List Char) × Int) :=
  (if (i ≥ (0 : Int)) then
    (let out_1 := (out ++ ([(Faithful.getD xs i)] : List (List Char)));
     (let i_1 := (i - (1 : Int));
      (Model.reverseArray_loop1 xs out_1 i_1)))
   else
    (out, i))
termination_by (((i - (0 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def reverseArray (xs : List (List Char)) : List (List Char) :=
  (let out := ([] : List (List Char));
   (let i := (((xs).length : Int) - (1 : Int));
    (let (out_1, i_1) := (Model.reverseArray_loop1 xs out i);
     out_1)))

def reverseArray_loop1_chk (xs : List (List Char)) (out : List (List Char)) (i : Int) : Faithful.Chk ((List (List Char) × Int)) :=
  do
    if (i ≥ (0 : Int)) then
      Faithful.ck (Faithful.inBounds xs i) "bounds check failed at line 11: xs[i]"
      let out_1 := (out ++ ([(Faithful.getD xs i)] : List (List Char)))
      Faithful.ck (Faithful.inRange (i - (1 : Int))) "range check failed at line 10: i--"
      let i_1 := (i - (1 : Int))
      Model.reverseArray_loop1_chk xs out_1 i_1
    else
      pure (out, i)
termination_by (((i - (0 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def reverseArray_chk (xs : List (List Char)) : Faithful.Chk (List (List Char)) :=
  do
    let out := ([] : List (List Char))
    Faithful.ck (Faithful.inRange (((xs).length : Int) - (1 : Int))) "range check failed at line 10: xs.length - 1"
    let i := (((xs).length : Int) - (1 : Int))
    let τ1 ← Model.reverseArray_loop1_chk xs out i
    let (out_1, i_1) := τ1
    pure out_1

def reverseArray_rangeOk (xs : List (List Char)) : Bool := Faithful.rangeOkOf (Model.reverseArray_chk xs)

def reverseArray_pre (xs : List (List Char)) : Bool :=
  (((xs).all (fun e0 => Faithful.bmp e0))) && (Model.reverseArray_rangeOk xs)

end Model
