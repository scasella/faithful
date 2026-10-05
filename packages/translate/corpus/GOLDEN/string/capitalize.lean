import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def capitalize (word : List Char) : List Char :=
  (if (((word).length : Int) = (0 : Int)) then
    word
   else
    ((Faithful.toUpper (Faithful.charAt word (0 : Int))) ++ (Faithful.toLower (Faithful.sliceFrom word (1 : Int)))))

def capitalize_chk (word : List Char) : Faithful.Chk (List Char) :=
  do
    if (((word).length : Int) = (0 : Int)) then
      pure word
    else
      Faithful.ckAscii (Faithful.charAt word (0 : Int)) "ascii check failed at line 14: word.charAt(0).toUpperCase()"
      Faithful.ckAscii (Faithful.sliceFrom word (1 : Int)) "ascii check failed at line 14: word.slice(1).toLowerCase()"
      Faithful.ck (decide ((((Faithful.toUpper (Faithful.charAt word (0 : Int))) ++ (Faithful.toLower (Faithful.sliceFrom word (1 : Int))))).length ≤ 16777216)) "length check failed at line 14: word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()"
      pure ((Faithful.toUpper (Faithful.charAt word (0 : Int))) ++ (Faithful.toLower (Faithful.sliceFrom word (1 : Int))))

def capitalize_rangeOk (word : List Char) : Bool := Faithful.rangeOkOf (Model.capitalize_chk word)

def capitalize_asciiOk (word : List Char) : Bool := Faithful.asciiOkOf (Model.capitalize_chk word)

def capitalize_pre (word : List Char) : Bool :=
  ((Faithful.bmp word)) && (Model.capitalize_rangeOk word) && (Model.capitalize_asciiOk word)

end Model
