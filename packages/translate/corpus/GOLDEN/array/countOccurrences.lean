import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def countOccurrences_loop1 (needle : List Char) (rest : List (List Char)) (count : Int) : Int :=
  (match rest with
   | [] =>
      count
   | w :: rest_1 =>
      (let count_2 := (if ((Faithful.toLower w) = needle) then
            (let count_1 := (count + (1 : Int));
             count_1)
           else
            count);
       (Model.countOccurrences_loop1 needle rest_1 count_2)))
termination_by rest.length
decreasing_by
  faithful_decreasing

def countOccurrences (words : List (List Char)) (target : List Char) : Int :=
  (let needle := (Faithful.toLower target);
   (let count := (0 : Int);
    (let xs := words;
     (let count_1 := (Model.countOccurrences_loop1 needle xs count);
      count_1))))

def countOccurrences_loop1_chk (needle : List Char) (rest : List (List Char)) (count : Int) : Faithful.Chk (Int) :=
  do
    match rest with
    | [] =>
      pure count
    | w :: rest_1 =>
      let τ1 ← do
          Faithful.ckAscii w "ascii check failed at line 11: w.toLowerCase()"
          if ((Faithful.toLower w) = needle) then
            Faithful.ck (Faithful.inRange (count + (1 : Int))) "range check failed at line 12: count += 1"
            let count_1 := (count + (1 : Int))
            pure count_1
          else
            pure count
      let count_2 := τ1
      Model.countOccurrences_loop1_chk needle rest_1 count_2
termination_by rest.length
decreasing_by
  faithful_decreasing

def countOccurrences_chk (words : List (List Char)) (target : List Char) : Faithful.Chk (Int) :=
  do
    Faithful.ckAscii target "ascii check failed at line 8: target.toLowerCase()"
    let needle := (Faithful.toLower target)
    let count := (0 : Int)
    let xs := words
    let τ1 ← Model.countOccurrences_loop1_chk needle xs count
    let count_1 := τ1
    pure count_1

def countOccurrences_rangeOk (words : List (List Char)) (target : List Char) : Bool := Faithful.rangeOkOf (Model.countOccurrences_chk words target)

def countOccurrences_asciiOk (words : List (List Char)) (target : List Char) : Bool := Faithful.asciiOkOf (Model.countOccurrences_chk words target)

def countOccurrences_pre (words : List (List Char)) (target : List Char) : Bool :=
  (((words).all (fun e0 => Faithful.bmp e0)) && (Faithful.bmp target)) && (Model.countOccurrences_rangeOk words target) && (Model.countOccurrences_asciiOk words target)

end Model
