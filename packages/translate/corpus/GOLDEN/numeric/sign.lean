import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def sign (x : Int) : Int :=
  (if (x > (0 : Int)) then
    (1 : Int)
   else
    (if (x < (0 : Int)) then
      (-1 : Int)
     else
      (0 : Int)))

def sign_chk (x : Int) : Faithful.Chk (Int) :=
  do
    if (x > (0 : Int)) then
      pure (1 : Int)
    else
      if (x < (0 : Int)) then
        pure (-1 : Int)
      else
        pure (0 : Int)

def sign_rangeOk (x : Int) : Bool := Faithful.rangeOkOf (Model.sign_chk x)

def sign_pre (x : Int) : Bool :=
  ((Faithful.intOk x)) && (Model.sign_rangeOk x)

end Model
