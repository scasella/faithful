import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

structure Rec1 where
  count : Int
  min_ : Int
  max_ : Int
  range : Int
  deriving Repr, Inhabited

instance : Lean.ToJson Rec1 := ⟨fun r => Lean.Json.mkObj [("count", Faithful.jInt r.count), ("min", Faithful.jInt r.min_), ("max", Faithful.jInt r.max_), ("range", Faithful.jInt r.range)]⟩

def spread_loop1 (rest : List (Int)) (lo : Int) (hi : Int) : (Int × Int) :=
  (match rest with
   | [] =>
      (lo, hi)
   | x :: rest_1 =>
      (let lo_2 := (if (x < lo) then
            (let lo_1 := x;
             lo_1)
           else
            lo);
       (let hi_2 := (if (x > hi) then
             (let hi_1 := x;
              hi_1)
            else
             hi);
        (Model.spread_loop1 rest_1 lo_2 hi_2))))
termination_by rest.length
decreasing_by
  faithful_decreasing

def spread (xs : List (Int)) : Option (Model.Rec1) :=
  (if (((xs).length : Int) = (0 : Int)) then
    (none : Option (Model.Rec1))
   else
    (let lo := (Faithful.getD xs (0 : Int));
     (let hi := (Faithful.getD xs (0 : Int));
      (let xs_1 := xs;
       (let (lo_1, hi_1) := (Model.spread_loop1 xs_1 lo hi);
        (some ({ count := ((xs).length : Int), min_ := lo_1, max_ := hi_1, range := (hi_1 - lo_1) } : Model.Rec1)))))))

def spread_loop1_chk (rest : List (Int)) (lo : Int) (hi : Int) : Faithful.Chk ((Int × Int)) :=
  do
    match rest with
    | [] =>
      pure (lo, hi)
    | x :: rest_1 =>
      let lo_2 := (if (x < lo) then
              (let lo_1 := x;
               lo_1)
             else
              lo)
      let hi_2 := (if (x > hi) then
              (let hi_1 := x;
               hi_1)
             else
              hi)
      Model.spread_loop1_chk rest_1 lo_2 hi_2
termination_by rest.length
decreasing_by
  faithful_decreasing

def spread_chk (xs : List (Int)) : Faithful.Chk (Option (Model.Rec1)) :=
  do
    if (((xs).length : Int) = (0 : Int)) then
      pure (none : Option (Model.Rec1))
    else
      Faithful.ck (Faithful.inBounds xs (0 : Int)) "bounds check failed at line 14: xs[0]"
      let lo := (Faithful.getD xs (0 : Int))
      Faithful.ck (Faithful.inBounds xs (0 : Int)) "bounds check failed at line 15: xs[0]"
      let hi := (Faithful.getD xs (0 : Int))
      let xs_1 := xs
      let τ1 ← Model.spread_loop1_chk xs_1 lo hi
      let (lo_1, hi_1) := τ1
      Faithful.ck (Faithful.inRange (hi_1 - lo_1)) "range check failed at line 24: hi - lo"
      pure (some ({ count := ((xs).length : Int), min_ := lo_1, max_ := hi_1, range := (hi_1 - lo_1) } : Model.Rec1))

def spread_rangeOk (xs : List (Int)) : Bool := Faithful.rangeOkOf (Model.spread_chk xs)

def spread_pre (xs : List (Int)) : Bool :=
  (((xs).all (fun e0 => Faithful.intOk e0))) && (Model.spread_rangeOk xs)

end Model
