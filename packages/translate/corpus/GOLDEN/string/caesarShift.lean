import Faithful.Core

set_option autoImplicit false
set_option linter.unusedVariables false

namespace Model

def caesarShift_loop1 (text : List Char) (lower : List Char) (upper : List Char) (k : Int) (out : List Char) (i : Int) : (List Char × Int) :=
  (if (i < ((text).length : Int)) then
    (let code := (Faithful.charCodeAt text i);
     (let out_5 := (if ((code ≥ (97 : Int)) ∧ (code ≤ (122 : Int))) then
           (let out_1 := (out ++ (Faithful.charAt lower (Int.tmod ((code - (97 : Int)) + k) (26 : Int))));
            out_1)
          else
           (let out_4 := (if ((code ≥ (65 : Int)) ∧ (code ≤ (90 : Int))) then
                 (let out_2 := (out ++ (Faithful.charAt upper (Int.tmod ((code - (65 : Int)) + k) (26 : Int))));
                  out_2)
                else
                 (let out_3 := (out ++ (Faithful.charAt text i));
                  out_3));
            out_4));
      (let i_1 := (i + (1 : Int));
       (Model.caesarShift_loop1 text lower upper k out_5 i_1))))
   else
    (out, i))
termination_by ((((text).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def caesarShift (text : List Char) (shift : Int) : List Char :=
  (let lower := ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
   (let upper := ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    (let k := (Int.tmod shift (26 : Int));
     (let out := ([] : List Char);
      (let i := (0 : Int);
       (let (out_1, i_1) := (Model.caesarShift_loop1 text lower upper k out i);
        out_1))))))

def caesarShift_loop1_chk (text : List Char) (lower : List Char) (upper : List Char) (k : Int) (out : List Char) (i : Int) : Faithful.Chk ((List Char × Int)) :=
  do
    if (i < ((text).length : Int)) then
      Faithful.ck (Faithful.inBounds text i) "bounds check failed at line 16: text.charCodeAt(i)"
      let code := (Faithful.charCodeAt text i)
      let τ1 ← do
          if ((code ≥ (97 : Int)) ∧ (code ≤ (122 : Int))) then
            Faithful.ck (Faithful.inRange (code - (97 : Int))) "range check failed at line 18: code - 97"
            Faithful.ck (Faithful.inRange ((code - (97 : Int)) + k)) "range check failed at line 18: code - 97 + k"
            Faithful.ck (decide ((26 : Int) ≠ 0)) "nonzero check failed at line 18: (code - 97 + k) % 26"
            Faithful.ck (decide (((out ++ (Faithful.charAt lower (Int.tmod ((code - (97 : Int)) + k) (26 : Int))))).length ≤ 16777216)) "length check failed at line 18: out += lower.charAt((code - 97 + k) % 26)"
            let out_1 := (out ++ (Faithful.charAt lower (Int.tmod ((code - (97 : Int)) + k) (26 : Int))))
            pure out_1
          else
            let τ2 ← do
                if ((code ≥ (65 : Int)) ∧ (code ≤ (90 : Int))) then
                  Faithful.ck (Faithful.inRange (code - (65 : Int))) "range check failed at line 20: code - 65"
                  Faithful.ck (Faithful.inRange ((code - (65 : Int)) + k)) "range check failed at line 20: code - 65 + k"
                  Faithful.ck (decide ((26 : Int) ≠ 0)) "nonzero check failed at line 20: (code - 65 + k) % 26"
                  Faithful.ck (decide (((out ++ (Faithful.charAt upper (Int.tmod ((code - (65 : Int)) + k) (26 : Int))))).length ≤ 16777216)) "length check failed at line 20: out += upper.charAt((code - 65 + k) % 26)"
                  let out_2 := (out ++ (Faithful.charAt upper (Int.tmod ((code - (65 : Int)) + k) (26 : Int))))
                  pure out_2
                else
                  Faithful.ck (decide (((out ++ (Faithful.charAt text i))).length ≤ 16777216)) "length check failed at line 22: out += text.charAt(i)"
                  let out_3 := (out ++ (Faithful.charAt text i))
                  pure out_3
            let out_4 := τ2
            pure out_4
      let out_5 := τ1
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 15: i++"
      let i_1 := (i + (1 : Int))
      Model.caesarShift_loop1_chk text lower upper k out_5 i_1
    else
      pure (out, i)
termination_by ((((text).length : Int) - i)).toNat
decreasing_by
  faithful_decreasing

def caesarShift_chk (text : List Char) (shift : Int) : Faithful.Chk (List Char) :=
  do
    let lower := ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
    let upper := ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']
    Faithful.ck (decide ((26 : Int) ≠ 0)) "nonzero check failed at line 13: shift % 26"
    let k := (Int.tmod shift (26 : Int))
    let out := ([] : List Char)
    let i := (0 : Int)
    let τ1 ← Model.caesarShift_loop1_chk text lower upper k out i
    let (out_1, i_1) := τ1
    pure out_1

def caesarShift_rangeOk (text : List Char) (shift : Int) : Bool := Faithful.rangeOkOf (Model.caesarShift_chk text shift)

def caesarShift_pre (text : List Char) (shift : Int) : Bool :=
  ((Faithful.intOk shift)) && ((Faithful.bmp text)) && (Model.caesarShift_rangeOk text shift)

end Model
