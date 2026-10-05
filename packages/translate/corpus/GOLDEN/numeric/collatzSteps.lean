import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def collatzSteps_loop1 (maxSteps : Int) (x : Int) (step : Int) : (Faithful.Flow (Int) ((Int × Int))) :=
  (if (step < (maxSteps + (1 : Int))) then
    (let x_1 := (if ((Int.tmod x (2 : Int)) = (0 : Int)) then
          (Int.fdiv x (2 : Int))
         else
          (((3 : Int) * x) + (1 : Int)));
     (if (x_1 = (1 : Int)) then
       (Faithful.Flow.ret step)
      else
       (let step_1 := (step + (1 : Int));
        (Model.collatzSteps_loop1 maxSteps x_1 step_1))))
   else
    (Faithful.Flow.next (x, step)))
termination_by (((maxSteps + (1 : Int)) - step)).toNat
decreasing_by
  faithful_decreasing

def collatzSteps (n : Int) (maxSteps : Int) : Except String (Int) :=
  do
    if (n < (1 : Int)) then
      throw "n must be a positive integer"
    else
      if (n = (1 : Int)) then
        pure (0 : Int)
      else
        let x := n
        let step := (1 : Int)
        match (Model.collatzSteps_loop1 maxSteps x step) with
        | .ret r =>
          pure r
        | .next (x_1, step_1) =>
          throw "step limit exceeded"

def collatzSteps_loop1_chk (maxSteps : Int) (x : Int) (step : Int) : Faithful.Chk ((Faithful.Flow (Int) ((Int × Int)))) :=
  do
    Faithful.ck (Faithful.inRange (maxSteps + (1 : Int))) "range check failed at line 17: maxSteps + 1"
    if (step < (maxSteps + (1 : Int))) then
      Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 18: x % 2"
      if ((Int.tmod x (2 : Int)) = (0 : Int)) then
        Faithful.ck (decide ((2 : Int) ≠ 0)) "nonzero check failed at line 18: Math.floor(x / 2)"
      if ¬ ((Int.tmod x (2 : Int)) = (0 : Int)) then
        Faithful.ck (Faithful.inRange ((3 : Int) * x)) "range check failed at line 18: 3 * x"
        Faithful.ck (Faithful.inRange (((3 : Int) * x) + (1 : Int))) "range check failed at line 18: 3 * x + 1"
      let x_1 := (if ((Int.tmod x (2 : Int)) = (0 : Int)) then
              (Int.fdiv x (2 : Int))
             else
              (((3 : Int) * x) + (1 : Int)))
      if (x_1 = (1 : Int)) then
        pure (Faithful.Flow.ret step)
      else
        Faithful.ck (Faithful.inRange (step + (1 : Int))) "range check failed at line 17: step++"
        let step_1 := (step + (1 : Int))
        Model.collatzSteps_loop1_chk maxSteps x_1 step_1
    else
      pure (Faithful.Flow.next (x, step))
termination_by (((maxSteps + (1 : Int)) - step)).toNat
decreasing_by
  faithful_decreasing

def collatzSteps_chk (n : Int) (maxSteps : Int) : Faithful.Chk (Int) :=
  do
    if (n < (1 : Int)) then
      throw (Faithful.Fail.thrown "n must be a positive integer")
    else
      if (n = (1 : Int)) then
        pure (0 : Int)
      else
        let x := n
        let step := (1 : Int)
        let τ1 ← Model.collatzSteps_loop1_chk maxSteps x step
        match τ1 with
        | .ret r =>
          pure r
        | .next (x_1, step_1) =>
          throw (Faithful.Fail.thrown "step limit exceeded")

def collatzSteps_rangeOk (n : Int) (maxSteps : Int) : Bool := Faithful.rangeOkOf (Model.collatzSteps_chk n maxSteps)

def collatzSteps_pre (n : Int) (maxSteps : Int) : Bool :=
  ((Faithful.intOk n) && (Faithful.intOk maxSteps)) && (Model.collatzSteps_rangeOk n maxSteps)

end Model
