import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def maxWindowSum_loop1 (xs : List (Int)) (k : Int) (best : Int) (i : Int) : (Int × Int) :=
  (if (i ≤ (((xs).length : Int) - k)) then
    (let s := (List.foldl (fun (acc : Int) (x : Int) =>
            (acc + x)) (0 : Int) (Faithful.slice xs i (i + k)));
     (let best_2 := (if (s > best) then
           (let best_1 := s;
            best_1)
          else
           best);
      (let i_1 := (i + (1 : Int));
       (Model.maxWindowSum_loop1 xs k best_2 i_1))))
   else
    (best, i))
termination_by ((((((xs).length : Int) - k) - i) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def maxWindowSum (xs : List (Int)) (k : Int) : Except String (Option (Int)) :=
  do
    if (k ≤ (0 : Int)) then
      throw "window size must be positive"
    else
      if (k > ((xs).length : Int)) then
        pure (none : Option (Int))
      else
        let best := (List.foldl (fun (acc : Int) (x : Int) =>
                  (acc + x)) (0 : Int) (Faithful.slice xs (0 : Int) k))
        let i := (1 : Int)
        let (best_1, i_1) := (Model.maxWindowSum_loop1 xs k best i)
        pure (some best_1)

def maxWindowSum_loop1_chk (xs : List (Int)) (k : Int) (best : Int) (i : Int) : Faithful.Chk ((Int × Int)) :=
  do
    Faithful.ck (Faithful.inRange (((xs).length : Int) - k)) "range check failed at line 19: xs.length - k"
    if (i ≤ (((xs).length : Int) - k)) then
      Faithful.ck (Faithful.inRange (i + k)) "range check failed at line 20: i + k"
      let τ1 ← List.foldlM (fun (acc : Int) (x : Int) => do
            Faithful.ck (Faithful.inRange (acc + x)) "range check failed at line 20: acc + x"
            pure (acc + x)) (0 : Int) (Faithful.slice xs i (i + k))
      let s := τ1
      let best_2 := (if (s > best) then
              (let best_1 := s;
               best_1)
             else
              best)
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 19: i++"
      let i_1 := (i + (1 : Int))
      Model.maxWindowSum_loop1_chk xs k best_2 i_1
    else
      pure (best, i)
termination_by ((((((xs).length : Int) - k) - i) + (1 : Int))).toNat
decreasing_by
  faithful_decreasing

def maxWindowSum_chk (xs : List (Int)) (k : Int) : Faithful.Chk (Option (Int)) :=
  do
    if (k ≤ (0 : Int)) then
      throw (Faithful.Fail.thrown "window size must be positive")
    else
      if (k > ((xs).length : Int)) then
        pure (none : Option (Int))
      else
        let τ1 ← List.foldlM (fun (acc : Int) (x : Int) => do
              Faithful.ck (Faithful.inRange (acc + x)) "range check failed at line 18: acc + x"
              pure (acc + x)) (0 : Int) (Faithful.slice xs (0 : Int) k)
        let best := τ1
        let i := (1 : Int)
        let τ2 ← Model.maxWindowSum_loop1_chk xs k best i
        let (best_1, i_1) := τ2
        pure (some best_1)

def maxWindowSum_rangeOk (xs : List (Int)) (k : Int) : Bool := Faithful.rangeOkOf (Model.maxWindowSum_chk xs k)

def maxWindowSum_pre (xs : List (Int)) (k : Int) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0)) && (Faithful.intOk k)) && (Model.maxWindowSum_rangeOk xs k)

end Model
