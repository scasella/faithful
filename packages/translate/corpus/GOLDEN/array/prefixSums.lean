import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def prefixSums_loop1 (xs : List (Int)) (acc : Int) (out : List (Int)) (i : Int) : (Int × List (Int) × Int) :=
  (if (i < ((xs).length : Int)) then
    (let acc_1 := (acc + (Faithful.getD xs i));
     (let out_1 := (out ++ ([acc_1] : List (Int)));
      (let i_1 := (i + (1 : Int));
       (Model.prefixSums_loop1 xs acc_1 out_1 i_1))))
   else
    (acc, out, i))
termination_by ((((xs).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def prefixSums (xs : List (Int)) : List (Int) :=
  (let acc := (0 : Int);
   (let out := ([(0 : Int)] : List (Int));
    (let i := (0 : Int);
     (let (acc_1, out_1, i_1) := (Model.prefixSums_loop1 xs acc out i);
      out_1))))

def prefixSums_loop1_chk (xs : List (Int)) (acc : Int) (out : List (Int)) (i : Int) : Faithful.Chk ((Int × List (Int) × Int)) :=
  do
    if (i < ((xs).length : Int)) then
      Faithful.ck (Faithful.inBounds xs i) "bounds check failed at line 13: xs[i]"
      Faithful.ck (Faithful.inRange (acc + (Faithful.getD xs i))) "range check failed at line 13: acc += xs[i]"
      let acc_1 := (acc + (Faithful.getD xs i))
      let out_1 := (out ++ ([acc_1] : List (Int)))
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 12: i++"
      let i_1 := (i + (1 : Int))
      Model.prefixSums_loop1_chk xs acc_1 out_1 i_1
    else
      pure (acc, out, i)
termination_by ((((xs).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def prefixSums_chk (xs : List (Int)) : Faithful.Chk (List (Int)) :=
  do
    let acc := (0 : Int)
    let out := ([(0 : Int)] : List (Int))
    let i := (0 : Int)
    let τ1 ← Model.prefixSums_loop1_chk xs acc out i
    let (acc_1, out_1, i_1) := τ1
    pure out_1

def prefixSums_rangeOk (xs : List (Int)) : Bool := Faithful.rangeOkOf (Model.prefixSums_chk xs)

def prefixSums_pre (xs : List (Int)) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0))) && (Model.prefixSums_rangeOk xs)

end Model
