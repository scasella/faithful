import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def prefixSumUntilNegative_loop1 (rest : List (Int)) (total : Int) : Int :=
  (match rest with
   | [] =>
      total
   | x :: rest_1 =>
      (if (x < (0 : Int)) then
        total
       else
        (let total_1 := (total + x);
         (Model.prefixSumUntilNegative_loop1 rest_1 total_1))))
termination_by rest.length
decreasing_by
  faithful_decreasing

def prefixSumUntilNegative (xs : List (Int)) : Int :=
  (let total := (0 : Int);
   (let xs_1 := xs;
    (let total_1 := (Model.prefixSumUntilNegative_loop1 xs_1 total);
     total_1)))

def prefixSumUntilNegative_loop1_chk (rest : List (Int)) (total : Int) : Faithful.Chk (Int) :=
  do
    match rest with
    | [] =>
      pure total
    | x :: rest_1 =>
      if (x < (0 : Int)) then
        pure total
      else
        Faithful.ck (Faithful.inRange (total + x)) "range check failed at line 17: total + x"
        let total_1 := (total + x)
        Model.prefixSumUntilNegative_loop1_chk rest_1 total_1
termination_by rest.length
decreasing_by
  faithful_decreasing

def prefixSumUntilNegative_chk (xs : List (Int)) : Faithful.Chk (Int) :=
  do
    let total := (0 : Int)
    let xs_1 := xs
    let τ1 ← Model.prefixSumUntilNegative_loop1_chk xs_1 total
    let total_1 := τ1
    pure total_1

def prefixSumUntilNegative_rangeOk (xs : List (Int)) : Bool := Faithful.rangeOkOf (Model.prefixSumUntilNegative_chk xs)

def prefixSumUntilNegative_pre (xs : List (Int)) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0))) && (Model.prefixSumUntilNegative_rangeOk xs)

end Model
