import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def countChar_loop1 (s : List Char) (ch : List Char) (count : Int) (i : Int) : (Int × Int) :=
  (if (i < ((s).length : Int)) then
    (let count_2 := (if ((Faithful.charAt s i) = ch) then
          (let count_1 := (count + (1 : Int));
           count_1)
         else
          count);
     (let i_1 := (i + (1 : Int));
      (Model.countChar_loop1 s ch count_2 i_1)))
   else
    (count, i))
termination_by ((((s).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def countChar (s : List Char) (ch : List Char) : Except String (Int) :=
  do
    if (((ch).length : Int) ≠ (1 : Int)) then
      throw "ch must be exactly one character"
    else
      let count := (0 : Int)
      let i := (0 : Int)
      let (count_1, i_1) := (Model.countChar_loop1 s ch count i)
      pure count_1

def countChar_loop1_chk (s : List Char) (ch : List Char) (count : Int) (i : Int) : Faithful.Chk ((Int × Int)) :=
  do
    if (i < ((s).length : Int)) then
      let τ1 ← do
          if ((Faithful.charAt s i) = ch) then
            Faithful.ck (Faithful.inRange (count + (1 : Int))) "range check failed at line 19: count++"
            let count_1 := (count + (1 : Int))
            pure count_1
          else
            pure count
      let count_2 := τ1
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 17: i++"
      let i_1 := (i + (1 : Int))
      Model.countChar_loop1_chk s ch count_2 i_1
    else
      pure (count, i)
termination_by ((((s).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def countChar_chk (s : List Char) (ch : List Char) : Faithful.Chk (Int) :=
  do
    if (((ch).length : Int) ≠ (1 : Int)) then
      throw (Faithful.Fail.thrown "ch must be exactly one character")
    else
      let count := (0 : Int)
      let i := (0 : Int)
      let τ1 ← Model.countChar_loop1_chk s ch count i
      let (count_1, i_1) := τ1
      pure count_1

def countChar_rangeOk (s : List Char) (ch : List Char) : Bool := Faithful.rangeOkOf (Model.countChar_chk s ch)

def countChar_pre (s : List Char) (ch : List Char) : Bool :=
  ((Faithful.bmp s) && (Faithful.bmp ch)) && (Model.countChar_rangeOk s ch)

end Model
