import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

structure Rec1 where
  char : List Char
  length : Int
  deriving Repr, Inhabited

instance : Lean.ToJson Rec1 := ⟨fun r => Lean.Json.mkObj [("char", Faithful.jStr r.char), ("length", Faithful.jInt r.length)]⟩

def longestRun_loop1 (s : List Char) (bestChar : List Char) (bestLen : Int) (runStart : Int) (i : Int) : (List Char × Int × Int × Int) :=
  (if (i ≤ ((s).length : Int)) then
    (let (bestChar_3, bestLen_3, runStart_2) := (if ((i = ((s).length : Int)) ∨ ((Faithful.charAt s i) ≠ (Faithful.charAt s runStart))) then
          (let len := (i - runStart);
           (let c := (Faithful.charAt s runStart);
            (let (bestChar_2, bestLen_2) := (if ((len > bestLen) ∨ ((len = bestLen) ∧ (Faithful.strLt c bestChar = true))) then
                  (let bestChar_1 := c;
                   (let bestLen_1 := len;
                    (bestChar_1, bestLen_1)))
                 else
                  (bestChar, bestLen));
             (let runStart_1 := i;
              (bestChar_2, bestLen_2, runStart_1)))))
         else
          (bestChar, bestLen, runStart));
     (let i_1 := (i + (1 : Int));
      (Model.longestRun_loop1 s bestChar_3 bestLen_3 runStart_2 i_1)))
   else
    (bestChar, bestLen, runStart, i))
termination_by (((((s).length : Int) - i) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def longestRun (s : List Char) : Option (Model.Rec1) :=
  (if (((s).length : Int) = (0 : Int)) then
    (none : Option (Model.Rec1))
   else
    (let bestChar := (Faithful.charAt s (0 : Int));
     (let bestLen := (1 : Int);
      (let runStart := (0 : Int);
       (let i := (1 : Int);
        (let (bestChar_1, bestLen_1, runStart_1, i_1) := (Model.longestRun_loop1 s bestChar bestLen runStart i);
         (some ({ char := bestChar_1, length := bestLen_1 } : Model.Rec1))))))))

def longestRun_loop1_chk (s : List Char) (bestChar : List Char) (bestLen : Int) (runStart : Int) (i : Int) : Faithful.Chk ((List Char × Int × Int × Int)) :=
  do
    if (i ≤ ((s).length : Int)) then
      let τ1 ← do
          if ((i = ((s).length : Int)) ∨ ((Faithful.charAt s i) ≠ (Faithful.charAt s runStart))) then
            Faithful.ck (Faithful.inRange (i - runStart)) "range check failed at line 21: i - runStart"
            let len := (i - runStart)
            let c := (Faithful.charAt s runStart)
            let (bestChar_2, bestLen_2) := (if ((len > bestLen) ∨ ((len = bestLen) ∧ (Faithful.strLt c bestChar = true))) then
                    (let bestChar_1 := c;
                     (let bestLen_1 := len;
                      (bestChar_1, bestLen_1)))
                   else
                    (bestChar, bestLen))
            let runStart_1 := i
            pure (bestChar_2, bestLen_2, runStart_1)
          else
            pure (bestChar, bestLen, runStart)
      let (bestChar_3, bestLen_3, runStart_2) := τ1
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 19: i++"
      let i_1 := (i + (1 : Int))
      Model.longestRun_loop1_chk s bestChar_3 bestLen_3 runStart_2 i_1
    else
      pure (bestChar, bestLen, runStart, i)
termination_by (((((s).length : Int) - i) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def longestRun_chk (s : List Char) : Faithful.Chk (Option (Model.Rec1)) :=
  do
    if (((s).length : Int) = (0 : Int)) then
      pure (none : Option (Model.Rec1))
    else
      let bestChar := (Faithful.charAt s (0 : Int))
      let bestLen := (1 : Int)
      let runStart := (0 : Int)
      let i := (1 : Int)
      let τ1 ← Model.longestRun_loop1_chk s bestChar bestLen runStart i
      let (bestChar_1, bestLen_1, runStart_1, i_1) := τ1
      pure (some ({ char := bestChar_1, length := bestLen_1 } : Model.Rec1))

def longestRun_rangeOk (s : List Char) : Bool := Faithful.rangeOkOf (Model.longestRun_chk s)

def longestRun_pre (s : List Char) : Bool :=
  ((Faithful.bmp s)) && (Model.longestRun_rangeOk s)

end Model
