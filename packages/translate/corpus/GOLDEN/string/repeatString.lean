import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def repeatString_loop1 (s : List Char) (count : Int) (separator : List Char) (out : List Char) (i : Int) : (List Char × Int) :=
  (if (i < count) then
    (let out_2 := (if (i > (0 : Int)) then
          (let out_1 := (out ++ separator);
           out_1)
         else
          out);
     (let out_3 := (out_2 ++ s);
      (let i_1 := (i + (1 : Int));
       (Model.repeatString_loop1 s count separator out_3 i_1))))
   else
    (out, i))
termination_by ((count - i)).toNat
decreasing_by
  faithful_decreasing

def repeatString (s : List Char) (count : Int) (separator : List Char) : Except String (List Char) :=
  do
    if (count < (0 : Int)) then
      throw "count must be non-negative"
    else
      let out := ([] : List Char)
      let i := (0 : Int)
      let (out_1, i_1) := (Model.repeatString_loop1 s count separator out i)
      pure out_1

def repeatString_loop1_chk (s : List Char) (count : Int) (separator : List Char) (out : List Char) (i : Int) : Faithful.Chk ((List Char × Int)) :=
  do
    if (i < count) then
      let τ1 ← do
          if (i > (0 : Int)) then
            Faithful.ck (decide (((out ++ separator)).length ≤ 16777216)) "length check failed at line 19: out += separator"
            let out_1 := (out ++ separator)
            pure out_1
          else
            pure out
      let out_2 := τ1
      Faithful.ck (decide (((out_2 ++ s)).length ≤ 16777216)) "length check failed at line 21: out += s"
      let out_3 := (out_2 ++ s)
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 17: i++"
      let i_1 := (i + (1 : Int))
      Model.repeatString_loop1_chk s count separator out_3 i_1
    else
      pure (out, i)
termination_by ((count - i)).toNat
decreasing_by
  faithful_decreasing

def repeatString_chk (s : List Char) (count : Int) (separator : List Char) : Faithful.Chk (List Char) :=
  do
    if (count < (0 : Int)) then
      throw (Faithful.Fail.thrown "count must be non-negative")
    else
      let out := ([] : List Char)
      let i := (0 : Int)
      let τ1 ← Model.repeatString_loop1_chk s count separator out i
      let (out_1, i_1) := τ1
      pure out_1

def repeatString_rangeOk (s : List Char) (count : Int) (separator : List Char) : Bool := Faithful.rangeOkOf (Model.repeatString_chk s count separator)

def repeatString_pre (s : List Char) (count : Int) (separator : List Char) : Bool :=
  ((Faithful.intOk count)) && ((Faithful.bmp s) && (Faithful.bmp separator)) && (Model.repeatString_rangeOk s count separator)

end Model
