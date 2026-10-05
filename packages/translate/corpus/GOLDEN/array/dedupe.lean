import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def dedupe_loop1 (rest : List (List Char)) (out : List (List Char)) : List (List Char) :=
  (match rest with
   | [] =>
      out
   | w :: rest_1 =>
      (let out_2 := (if (¬ ((Faithful.includes out w) = true)) then
            (let out_1 := (out ++ ([w] : List (List Char)));
             out_1)
           else
            out);
       (Model.dedupe_loop1 rest_1 out_2)))
termination_by rest.length
decreasing_by
  faithful_decreasing

def dedupe (words : List (List Char)) : List (List Char) :=
  (let out := ([] : List (List Char));
   (let xs := words;
    (let out_1 := (Model.dedupe_loop1 xs out);
     out_1)))

def dedupe_loop1_chk (rest : List (List Char)) (out : List (List Char)) : Faithful.Chk (List (List Char)) :=
  do
    match rest with
    | [] =>
      pure out
    | w :: rest_1 =>
      let out_2 := (if (¬ ((Faithful.includes out w) = true)) then
              (let out_1 := (out ++ ([w] : List (List Char)));
               out_1)
             else
              out)
      Model.dedupe_loop1_chk rest_1 out_2
termination_by rest.length
decreasing_by
  faithful_decreasing

def dedupe_chk (words : List (List Char)) : Faithful.Chk (List (List Char)) :=
  do
    let out := ([] : List (List Char))
    let xs := words
    let τ1 ← Model.dedupe_loop1_chk xs out
    let out_1 := τ1
    pure out_1

def dedupe_rangeOk (words : List (List Char)) : Bool := Faithful.rangeOkOf (Model.dedupe_chk words)

def dedupe_pre (words : List (List Char)) : Bool :=
  (((words).all (fun e0 => Faithful.bmp e0))) && (Model.dedupe_rangeOk words)

end Model
