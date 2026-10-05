import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def trimControl_loop1 (s : List Char) (end_ : Int) (start : Int) : Int :=
  (if ((start < end_) ∧ ((Faithful.charCodeAt s start) ≤ (32 : Int))) then
    (let start_1 := (start + (1 : Int));
     (Model.trimControl_loop1 s end_ start_1))
   else
    start)
termination_by ((end_ - start)).toNat
decreasing_by
  faithful_decreasing

def trimControl_loop2 (s : List Char) (start : Int) (end_ : Int) : Int :=
  (if ((end_ > start) ∧ ((Faithful.charCodeAt s (end_ - (1 : Int))) ≤ (32 : Int))) then
    (let end__1 := (end_ - (1 : Int));
     (Model.trimControl_loop2 s start end__1))
   else
    end_)
termination_by ((end_ - start)).toNat
decreasing_by
  faithful_decreasing

def trimControl (s : List Char) : List Char :=
  (let start := (0 : Int);
   (let end_ := ((s).length : Int);
    (let start_1 := (Model.trimControl_loop1 s end_ start);
     (let end__1 := (Model.trimControl_loop2 s start_1 end_);
      (Faithful.slice s start_1 end__1)))))

def trimControl_loop1_chk (s : List Char) (end_ : Int) (start : Int) : Faithful.Chk (Int) :=
  do
    if (start < end_) then
      Faithful.ck (Faithful.inBounds s start) "bounds check failed at line 13: s.charCodeAt(start)"
    if ((start < end_) ∧ ((Faithful.charCodeAt s start) ≤ (32 : Int))) then
      Faithful.ck (Faithful.inRange (start + (1 : Int))) "range check failed at line 14: start++"
      let start_1 := (start + (1 : Int))
      Model.trimControl_loop1_chk s end_ start_1
    else
      pure start
termination_by ((end_ - start)).toNat
decreasing_by
  faithful_decreasing

def trimControl_loop2_chk (s : List Char) (start : Int) (end_ : Int) : Faithful.Chk (Int) :=
  do
    if (end_ > start) then
      Faithful.ck (Faithful.inRange (end_ - (1 : Int))) "range check failed at line 16: end - 1"
      Faithful.ck (Faithful.inBounds s (end_ - (1 : Int))) "bounds check failed at line 16: s.charCodeAt(end - 1)"
    if ((end_ > start) ∧ ((Faithful.charCodeAt s (end_ - (1 : Int))) ≤ (32 : Int))) then
      Faithful.ck (Faithful.inRange (end_ - (1 : Int))) "range check failed at line 17: end--"
      let end__1 := (end_ - (1 : Int))
      Model.trimControl_loop2_chk s start end__1
    else
      pure end_
termination_by ((end_ - start)).toNat
decreasing_by
  faithful_decreasing

def trimControl_chk (s : List Char) : Faithful.Chk (List Char) :=
  do
    let start := (0 : Int)
    let end_ := ((s).length : Int)
    let τ1 ← Model.trimControl_loop1_chk s end_ start
    let start_1 := τ1
    let τ2 ← Model.trimControl_loop2_chk s start_1 end_
    let end__1 := τ2
    pure (Faithful.slice s start_1 end__1)

def trimControl_rangeOk (s : List Char) : Bool := Faithful.rangeOkOf (Model.trimControl_chk s)

def trimControl_pre (s : List Char) : Bool :=
  ((Faithful.bmp s)) && (Model.trimControl_rangeOk s)

end Model
