import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def countVowels_loop1 (vowels : List Char) (lower : List Char) (n : Int) (i : Int) : (Int × Int) :=
  (if (i < ((lower).length : Int)) then
    (let n_2 := (if ((Faithful.strIndexOf vowels (Faithful.charAt lower i) (0 : Int)) ≠ (-1 : Int)) then
          (let n_1 := (n + (1 : Int));
           n_1)
         else
          n);
     (let i_1 := (i + (1 : Int));
      (Model.countVowels_loop1 vowels lower n_2 i_1)))
   else
    (n, i))
termination_by ((((lower).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def countVowels (text : List Char) : Int :=
  (let vowels := ['a', 'e', 'i', 'o', 'u'];
   (let lower := (Faithful.toLower text);
    (let n := (0 : Int);
     (let i := (0 : Int);
      (let (n_1, i_1) := (Model.countVowels_loop1 vowels lower n i);
       n_1)))))

def countVowels_loop1_chk (vowels : List Char) (lower : List Char) (n : Int) (i : Int) : Faithful.Chk ((Int × Int)) :=
  do
    if (i < ((lower).length : Int)) then
      let τ1 ← do
          if ((Faithful.strIndexOf vowels (Faithful.charAt lower i) (0 : Int)) ≠ (-1 : Int)) then
            Faithful.ck (Faithful.inRange (n + (1 : Int))) "range check failed at line 16: n++"
            let n_1 := (n + (1 : Int))
            pure n_1
          else
            pure n
      let n_2 := τ1
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 14: i++"
      let i_1 := (i + (1 : Int))
      Model.countVowels_loop1_chk vowels lower n_2 i_1
    else
      pure (n, i)
termination_by ((((lower).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def countVowels_chk (text : List Char) : Faithful.Chk (Int) :=
  do
    let vowels := ['a', 'e', 'i', 'o', 'u']
    Faithful.ckAscii text "ascii check failed at line 12: text.toLowerCase()"
    let lower := (Faithful.toLower text)
    let n := (0 : Int)
    let i := (0 : Int)
    let τ1 ← Model.countVowels_loop1_chk vowels lower n i
    let (n_1, i_1) := τ1
    pure n_1

def countVowels_rangeOk (text : List Char) : Bool := Faithful.rangeOkOf (Model.countVowels_chk text)

def countVowels_asciiOk (text : List Char) : Bool := Faithful.asciiOkOf (Model.countVowels_chk text)

def countVowels_pre (text : List Char) : Bool :=
  ((Faithful.bmp text)) && (Model.countVowels_rangeOk text) && (Model.countVowels_asciiOk text)

end Model
