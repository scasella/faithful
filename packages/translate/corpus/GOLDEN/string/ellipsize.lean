import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def ellipsize (s : List Char) (max_ : Int) : List Char :=
  (if (((s).length : Int) ≤ max_) then
    s
   else
    (let keep := (max_ - (1 : Int));
     (let head := (Faithful.cdiv keep (2 : Int));
      (let tail := (Int.fdiv keep (2 : Int));
       (((Faithful.slice s (0 : Int) head) ++ ['\u2026']) ++ (Faithful.sliceFrom s (((s).length : Int) - tail)))))))

def ellipsize_chk (s : List Char) (max_ : Int) : Faithful.Chk (List Char) :=
  do
    if (((s).length : Int) ≤ max_) then
      pure s
    else
      Faithful.ck (Faithful.inRange (max_ - (1 : Int))) "range check failed at line 15: max - 1"
      let keep := (max_ - (1 : Int))
      Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 16: Math.ceil(keep / 2)"
      let head := (Faithful.cdiv keep (2 : Int))
      Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 17: Math.floor(keep / 2)"
      let tail := (Int.fdiv keep (2 : Int))
      Faithful.ck (decide ((((Faithful.slice s (0 : Int) head) ++ ['\u2026'])).length ≤ 16777216)) "length check failed at line 18: s.slice(0, head) + \"…\""
      Faithful.ck (Faithful.inRange (((s).length : Int) - tail)) "range check failed at line 18: s.length - tail"
      Faithful.ck (decide (((((Faithful.slice s (0 : Int) head) ++ ['\u2026']) ++ (Faithful.sliceFrom s (((s).length : Int) - tail)))).length ≤ 16777216)) "length check failed at line 18: s.slice(0, head) + \"…\" + s.slice(s.length - tail)"
      pure (((Faithful.slice s (0 : Int) head) ++ ['\u2026']) ++ (Faithful.sliceFrom s (((s).length : Int) - tail)))

def ellipsize_rangeOk (s : List Char) (max_ : Int) : Bool := Faithful.rangeOkOf (Model.ellipsize_chk s max_)

def ellipsize_pre (s : List Char) (max_ : Int) : Bool :=
  ((Faithful.intOk max_)) && ((Faithful.bmp s)) && (Model.ellipsize_rangeOk s max_)

end Model
