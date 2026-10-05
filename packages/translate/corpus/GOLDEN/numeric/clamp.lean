import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def clamp (value : Int) (lo : Int) (hi : Int) : Except String (Int) :=
  do
    if (lo > hi) then
      throw "clamp: lower bound exceeds upper bound"
    else
      pure (Min.min (Max.max value lo) hi)

def clamp_chk (value : Int) (lo : Int) (hi : Int) : Faithful.Chk (Int) :=
  do
    if (lo > hi) then
      throw (Faithful.Fail.thrown "clamp: lower bound exceeds upper bound")
    else
      pure (Min.min (Max.max value lo) hi)

def clamp_rangeOk (value : Int) (lo : Int) (hi : Int) : Bool := Faithful.rangeOkOf (Model.clamp_chk value lo hi)

def clamp_pre (value : Int) (lo : Int) (hi : Int) : Bool :=
  ((Faithful.intOk value) && (Faithful.intOk lo) && (Faithful.intOk hi)) && (Model.clamp_rangeOk value lo hi)

end Model
