import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def reverseString_loop1 (s : List Char) (out : List Char) (i : Int) : (List Char × Int) :=
  (if (i ≥ (0 : Int)) then
    (let out_1 := (out ++ (Faithful.charAt s i));
     (let i_1 := (i - (1 : Int));
      (Model.reverseString_loop1 s out_1 i_1)))
   else
    (out, i))
termination_by (((i - (0 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def reverseString (s : List Char) : List Char :=
  (let out := ([] : List Char);
   (let i := (((s).length : Int) - (1 : Int));
    (let (out_1, i_1) := (Model.reverseString_loop1 s out i);
     out_1)))

def reverseString_loop1_chk (s : List Char) (out : List Char) (i : Int) : Faithful.Chk ((List Char × Int)) :=
  do
    if (i ≥ (0 : Int)) then
      Faithful.ck (decide (((out ++ (Faithful.charAt s i))).length ≤ 16777216)) "length check failed at line 13: out += s.charAt(i)"
      let out_1 := (out ++ (Faithful.charAt s i))
      Faithful.ck (Faithful.inRange (i - (1 : Int))) "range check failed at line 12: i--"
      let i_1 := (i - (1 : Int))
      Model.reverseString_loop1_chk s out_1 i_1
    else
      pure (out, i)
termination_by (((i - (0 : Int)) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def reverseString_chk (s : List Char) : Faithful.Chk (List Char) :=
  do
    let out := ([] : List Char)
    Faithful.ck (Faithful.inRange (((s).length : Int) - (1 : Int))) "range check failed at line 12: s.length - 1"
    let i := (((s).length : Int) - (1 : Int))
    let τ1 ← Model.reverseString_loop1_chk s out i
    let (out_1, i_1) := τ1
    pure out_1

def reverseString_rangeOk (s : List Char) : Bool := Faithful.rangeOkOf (Model.reverseString_chk s)

def reverseString_pre (s : List Char) : Bool :=
  ((Faithful.bmp s)) && (Model.reverseString_rangeOk s)

end Model
