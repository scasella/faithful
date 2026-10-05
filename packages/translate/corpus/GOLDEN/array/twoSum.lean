import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def twoSum_loop2 (xs : List (Int)) (target : Int) (i : Int) (j : Int) : (Faithful.Flow (Option ((Int × Int))) (Int)) :=
  (if (j < ((xs).length : Int)) then
    (if (((Faithful.getD xs i) + (Faithful.getD xs j)) = target) then
      (Faithful.Flow.ret (some (i, j)))
     else
      (let j_1 := (j + (1 : Int));
       (Model.twoSum_loop2 xs target i j_1)))
   else
    (Faithful.Flow.next j))
termination_by ((((xs).length : Int) - j)).toNat
decreasing_by
  faithful_decreasing

def twoSum_loop1 (xs : List (Int)) (target : Int) (i : Int) : (Faithful.Flow (Option ((Int × Int))) (Int)) :=
  (if (i < ((xs).length : Int)) then
    (let j := (i + (1 : Int));
     (match (Model.twoSum_loop2 xs target i j) with
      | .ret r =>
         (Faithful.Flow.ret r)
      | .next j_1 =>
         (let i_1 := (i + (1 : Int));
          (Model.twoSum_loop1 xs target i_1))))
   else
    (Faithful.Flow.next i))
termination_by ((((xs).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def twoSum (xs : List (Int)) (target : Int) : Option ((Int × Int)) :=
  (let i := (0 : Int);
   (match (Model.twoSum_loop1 xs target i) with
    | .ret r =>
       r
    | .next i_1 =>
       (none : Option ((Int × Int)))))

def twoSum_loop2_chk (xs : List (Int)) (target : Int) (i : Int) (j : Int) : Faithful.Chk ((Faithful.Flow (Option ((Int × Int))) (Int))) :=
  do
    if (j < ((xs).length : Int)) then
      Faithful.ck (Faithful.inBounds xs i) "bounds check failed at line 11: xs[i]"
      Faithful.ck (Faithful.inBounds xs j) "bounds check failed at line 11: xs[j]"
      Faithful.ck (Faithful.inRange ((Faithful.getD xs i) + (Faithful.getD xs j))) "range check failed at line 11: xs[i] + xs[j]"
      if (((Faithful.getD xs i) + (Faithful.getD xs j)) = target) then
        pure (Faithful.Flow.ret (some (i, j)))
      else
        Faithful.ck (Faithful.inRange (j + (1 : Int))) "range check failed at line 10: j++"
        let j_1 := (j + (1 : Int))
        Model.twoSum_loop2_chk xs target i j_1
    else
      pure (Faithful.Flow.next j)
termination_by ((((xs).length : Int) - j)).toNat
decreasing_by
  faithful_decreasing

def twoSum_loop1_chk (xs : List (Int)) (target : Int) (i : Int) : Faithful.Chk ((Faithful.Flow (Option ((Int × Int))) (Int))) :=
  do
    if (i < ((xs).length : Int)) then
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 10: i + 1"
      let j := (i + (1 : Int))
      let τ1 ← Model.twoSum_loop2_chk xs target i j
      match τ1 with
      | .ret r =>
        pure (Faithful.Flow.ret r)
      | .next j_1 =>
        Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 9: i++"
        let i_1 := (i + (1 : Int))
        Model.twoSum_loop1_chk xs target i_1
    else
      pure (Faithful.Flow.next i)
termination_by ((((xs).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def twoSum_chk (xs : List (Int)) (target : Int) : Faithful.Chk (Option ((Int × Int))) :=
  do
    let i := (0 : Int)
    let τ1 ← Model.twoSum_loop1_chk xs target i
    match τ1 with
    | .ret r =>
      pure r
    | .next i_1 =>
      pure (none : Option ((Int × Int)))

def twoSum_rangeOk (xs : List (Int)) (target : Int) : Bool := Faithful.rangeOkOf (Model.twoSum_chk xs target)

def twoSum_pre (xs : List (Int)) (target : Int) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0)) && (Faithful.intOk target)) && (Model.twoSum_rangeOk xs target)

end Model
