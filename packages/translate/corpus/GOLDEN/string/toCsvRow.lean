import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def toCsvRow (fields : List (List Char)) : List Char :=
  (Faithful.join (List.map (fun (field : List Char) =>
        (if (((((Faithful.strIndexOf field [','] (0 : Int)) ≠ (-1 : Int)) ∨ ((Faithful.strIndexOf field ['"'] (0 : Int)) ≠ (-1 : Int))) ∨ ((Faithful.strIndexOf field ['\n'] (0 : Int)) ≠ (-1 : Int))) ∨ ((Faithful.strIndexOf field ['\r'] (0 : Int)) ≠ (-1 : Int))) then
          ((['"'] ++ (Faithful.join (Faithful.split field ['"']) ['"', '"'])) ++ ['"'])
         else
          field)) fields) [','])

def toCsvRow_chk (fields : List (List Char)) : Faithful.Chk (List Char) :=
  do
    let τ1 ← List.mapM (fun (field : List Char) => do
          if (((((Faithful.strIndexOf field [','] (0 : Int)) ≠ (-1 : Int)) ∨ ((Faithful.strIndexOf field ['"'] (0 : Int)) ≠ (-1 : Int))) ∨ ((Faithful.strIndexOf field ['\n'] (0 : Int)) ≠ (-1 : Int))) ∨ ((Faithful.strIndexOf field ['\r'] (0 : Int)) ≠ (-1 : Int))) then
            Faithful.ck (decide (((Faithful.join (Faithful.split field ['"']) ['"', '"'])).length ≤ 16777216)) "length check failed at line 18: field.split('\"').join('\"\"')"
            Faithful.ck (decide ((((['"'] ++ (Faithful.join (Faithful.split field ['"']) ['"', '"'])) ++ ['"'])).length ≤ 16777216)) "length check failed at line 18: `\"${field.split('\"').join('\"\"')}\"`"
            pure ((['"'] ++ (Faithful.join (Faithful.split field ['"']) ['"', '"'])) ++ ['"'])
          else
            pure field) fields
    Faithful.ck (decide (((Faithful.join τ1 [','])).length ≤ 16777216)) "length check failed at line 12: fields .map((field) => field.indexOf(\",\") !== -1 || field..."
    pure (Faithful.join τ1 [','])

def toCsvRow_rangeOk (fields : List (List Char)) : Bool := Faithful.rangeOkOf (Model.toCsvRow_chk fields)

def toCsvRow_pre (fields : List (List Char)) : Bool :=
  (((fields).all (fun e0 => Faithful.bmp e0))) && (Model.toCsvRow_rangeOk fields)

end Model
