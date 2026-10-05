import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def digitSum_loop1 (n : Int) (sum : Int) : (Int × Int) :=
  (if (n > (0 : Int)) then
    (let sum_1 := (sum + (Int.tmod n (10 : Int)));
     (let n_1 := (Int.fdiv n (10 : Int));
      (Model.digitSum_loop1 n_1 sum_1)))
   else
    (n, sum))
termination_by ((n - (0 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := n) (k := 10) (by omega) (by decide))
  faithful_decreasing

def digitSum (value : Int) : Int :=
  (let n := (Faithful.iabs value);
   (let sum := (0 : Int);
    (let (n_1, sum_1) := (Model.digitSum_loop1 n sum);
     sum_1)))

def digitSum_loop1_chk (n : Int) (sum : Int) : Faithful.Chk ((Int × Int)) :=
  do
    if (n > (0 : Int)) then
      Faithful.ck (decide ((10 : Int) ≠ 0)) "nonzero check failed at line 12: n % 10"
      Faithful.ck (Faithful.inRange (sum + (Int.tmod n (10 : Int)))) "range check failed at line 12: sum + (n % 10)"
      let sum_1 := (sum + (Int.tmod n (10 : Int)))
      Faithful.ck (decide ((10 : Int) ≠ 0)) "nonzero check failed at line 13: Math.floor(n / 10)"
      let n_1 := (Int.fdiv n (10 : Int))
      Model.digitSum_loop1_chk n_1 sum_1
    else
      pure (n, sum)
termination_by ((n - (0 : Int))).toNat
decreasing_by
  all_goals (try have := Faithful.fdiv_lt_self (a := n) (k := 10) (by omega) (by decide))
  faithful_decreasing

def digitSum_chk (value : Int) : Faithful.Chk (Int) :=
  do
    let n := (Faithful.iabs value)
    let sum := (0 : Int)
    let τ1 ← Model.digitSum_loop1_chk n sum
    let (n_1, sum_1) := τ1
    pure sum_1

def digitSum_rangeOk (value : Int) : Bool := Faithful.rangeOkOf (Model.digitSum_chk value)

def digitSum_pre (value : Int) : Bool :=
  ((Faithful.intOk value)) && (Model.digitSum_rangeOk value)

end Model
