import Lean.Data.Json

/-!
# Faithful.Core: runtime support for generated models

Every model produced by `packages/translate` starts with `import Faithful.Core`. This file holds the total, executable
definitions the translator maps JavaScript operations to. Each definition states the JavaScript behaviour it reproduces;
the translator's tests evaluate them against Node on a table of edge cases (negative and out-of-range indices, empty
separators, missing elements).

Value representation (docs/DESIGN.md):
* `number` is `Int`; the precondition `rangeOk` keeps every intermediate within `±2^53`.
* `string` is `List Char` restricted to the Basic Multilingual Plane, so one `Char` is one UTF-16 code unit.
* arrays are `List`, tuples are (right-nested) products, records are structures emitted with the model.

No Mathlib here: models must stay cheap to import (docs/DESIGN.md, "Toolchain facts").
-/

namespace Faithful

open Lean

/-! ## Integer bound -/

/-- `2^53`, the bound every intermediate integer must respect (`MAX_SAFE` in contracts.ts). -/
def MAX : Int := 9007199254740992

/-- `|x| ≤ 2^53`. -/
def inRange (x : Int) : Bool := decide (-MAX ≤ x ∧ x ≤ MAX)

/-- The `int-bound` precondition for one integer argument. -/
abbrev intOk (x : Int) : Bool := inRange x

/-! ## Total reads -/

/-- `xs[i]` with a default outside `0 ≤ i < length` (JavaScript yields `undefined` there; `rangeOk` excludes it). -/
def getD {α : Type} [Inhabited α] (xs : List α) (i : Int) : α :=
  if i < 0 then default else xs.getD i.toNat default

/-- `0 ≤ i < xs.length`. -/
def inBounds {α : Type} (xs : List α) (i : Int) : Bool := decide (0 ≤ i ∧ i < (xs.length : Int))

/-! ## Arithmetic helpers -/

/-- `Math.abs` on integers. -/
def iabs (x : Int) : Int := (Int.natAbs x : Int)

/-- `Math.ceil(a / b)` for integers: `-(⌊-a / b⌋)`. -/
def cdiv (a b : Int) : Int := -(Int.fdiv (-a) b)

theorem fdiv_lt_self {a k : Int} (ha : 0 < a) (hk : 1 < k) : Int.fdiv a k < a := by
  have hk0 : 0 ≤ k := by omega
  have h : Int.fdiv a k = a / k := by
    rw [Int.fdiv_eq_ediv]; simp [hk0]
  rw [h]
  have h1 : a / k * k ≤ a := Int.ediv_mul_le a (by omega)
  have h2 : 0 ≤ a / k := Int.ediv_nonneg (by omega) (by omega)
  rcases Int.lt_or_le (a / k) a with h | h
  · exact h
  · have : a * k ≤ a / k * k := Int.mul_le_mul_of_nonneg_right h (by omega)
    have : a * 2 ≤ a * k := Int.mul_le_mul_of_nonneg_left (by omega) (by omega)
    omega

/-! ## Slicing (Array.prototype.slice and String.prototype.slice have the same index rules) -/

/-- Relative index normalisation of `slice`: negative counts from the end, then clamp to `[0, len]`. -/
def sliceIdx (len i : Int) : Int := if i < 0 then max (len + i) 0 else min i len

/-- `xs.slice(a, b)`. -/
def slice {α : Type} (xs : List α) (a b : Int) : List α :=
  let len : Int := xs.length
  let s := sliceIdx len a
  let e := sliceIdx len b
  (xs.drop s.toNat).take (e - s).toNat

/-- `xs.slice(a)` (end defaults to the length). -/
def sliceFrom {α : Type} (xs : List α) (a : Int) : List α := slice xs a xs.length

theorem sliceFrom_length_lt {α : Type} (xs : List α) {k : Int} (hk : 1 ≤ k) (hne : 0 < xs.length) :
    (sliceFrom xs k).length < xs.length := by
  unfold sliceFrom slice sliceIdx
  have : ¬ k < 0 := by omega
  simp only [this, ite_false, List.length_take, List.length_drop]
  omega

/-- `s !== ""` / `xs ≠ []` gives a positive length (termination of `s.slice(k)` under a `s !== ""` guard). -/
theorem length_pos_of_ne_nil {α : Type} {xs : List α} (h : ¬ xs = []) : 0 < xs.length :=
  List.length_pos_iff.mpr h

/-- The same with the empty literal on the left: `"" !== s` reaches `decreasing_by` as `h : [] ≠ s` / `¬ [] = s`
(red-team round 3, r3LoopEmptyStrLeft / r3RecEmptyStrLeft*). -/
theorem length_pos_of_nil_ne {α : Type} {xs : List α} (h : ¬ [] = xs) : 0 < xs.length :=
  List.length_pos_iff.mpr (fun e => h e.symm)

/-- General form: `xs = []` is contradictory. Used when the non-empty guard is one part of a compound guard
(`"" !== s && ...`, `!(s === "" || ...)`): `faithful_len_pos` substitutes `xs := []` and lets `simp_all` find the
false hypothesis. -/
theorem length_pos_of_eq_nil_false {α : Type} {xs : List α} (h : xs = [] → False) : 0 < xs.length :=
  List.length_pos_iff.mpr h

/-! ## Search -/

/-- `xs.indexOf(x)` (strict equality on primitives): first index, or `-1`. -/
def indexOf {α : Type} [BEq α] (xs : List α) (x : α) : Int :=
  match xs.findIdx? (· == x) with
  | some i => (i : Int)
  | none => -1

/-- `xs.includes(x)` on primitives. -/
def includes {α : Type} [BEq α] (xs : List α) (x : α) : Bool := xs.any (· == x)

/-- Helper of `strIndexOf`: smallest `k + offset` such that `sub` is a prefix of the remaining text, else `-1`. -/
def indexOfAux (sub : List Char) : List Char → Nat → Int
  | rest, k =>
    if sub.isPrefixOf rest then (k : Int)
    else match rest with
      | [] => -1
      | _ :: t => indexOfAux sub t (k + 1)

/-- `s.indexOf(sub, pos)`: start at `pos` clamped to `[0, length]`; an empty `sub` is found at the start position. -/
def strIndexOf (s sub : List Char) (pos : Int) : Int :=
  let start := (min (max pos 0) (s.length : Int)).toNat
  indexOfAux sub (s.drop start) start

/-! ## Strings -/

/-- `s.charAt(i)`: the one-unit string at `i`, or `""` out of range. -/
def charAt (s : List Char) (i : Int) : List Char :=
  if 0 ≤ i ∧ i < (s.length : Int) then [s.getD i.toNat 'a'] else []

/-- `s[i]` on a string (`undefined` out of range in JavaScript; `rangeOk` excludes that). -/
def strAt (s : List Char) (i : Int) : List Char := [getD s i]

/-- `s.charCodeAt(i)` (NaN out of range in JavaScript; `rangeOk` excludes that, the model reads 0). -/
def charCodeAt (s : List Char) (i : Int) : Int := if inBounds s i then ((getD s i).toNat : Int) else 0

/-- Helper of `split` for a non-empty separator `s0 :: st`. -/
def splitAux (s0 : Char) (st : List Char) : List Char → List Char → List (List Char)
  | [], cur => [cur.reverse]
  | c :: t, cur =>
    if (s0 :: st).isPrefixOf (c :: t) then
      cur.reverse :: splitAux s0 st ((c :: t).drop (st.length + 1)) []
    else
      splitAux s0 st t (c :: cur)
termination_by rest => rest.length
decreasing_by all_goals (simp_wf <;> omega)

/-- `s.split(sep)` without a limit. Empty separator: one string per code unit (`"".split("")` is `[]`);
otherwise `"".split(sep)` is `[""]` and matches are found left to right without overlap. -/
def split (s sep : List Char) : List (List Char) :=
  match sep with
  | [] => s.map (fun c => [c])
  | s0 :: st => splitAux s0 st s []

/-- `xs.join(sep)` on an array of strings. -/
def join (xs : List (List Char)) (sep : List Char) : List Char :=
  match xs with
  | [] => []
  | [x] => x
  | x :: rest => x ++ sep ++ join rest sep

/-- Decimal text of an integer, as `String(n)` prints it for `|n| ≤ 2^53` (no exponent form below 10^21). -/
def intToStr (n : Int) : List Char := (toString n).toList

/-- `String(b)`. -/
def boolToStr (b : Bool) : List Char := if b then ['t', 'r', 'u', 'e'] else ['f', 'a', 'l', 's', 'e']

/-- ASCII-only lower-casing (JavaScript maps all of Unicode; the `ascii` precondition keeps them equal). -/
def lowerChar (c : Char) : Char :=
  if 'A'.toNat ≤ c.toNat ∧ c.toNat ≤ 'Z'.toNat then Char.ofNat (c.toNat + 32) else c

def upperChar (c : Char) : Char :=
  if 'a'.toNat ≤ c.toNat ∧ c.toNat ≤ 'z'.toNat then Char.ofNat (c.toNat - 32) else c

def toLower (s : List Char) : List Char := s.map lowerChar
def toUpper (s : List Char) : List Char := s.map upperChar

def isAscii (s : List Char) : Bool := s.all (fun c => decide (c.toNat < 128))

/-- Basic Multilingual Plane text: every character is one UTF-16 code unit. -/
def bmp (s : List Char) : Bool := s.all (fun c => decide (c.toNat < 65536))

/-- `a < b` on strings: lexicographic on code units (= code points for BMP text). -/
def strLt : List Char → List Char → Bool
  | [], [] => false
  | [], _ :: _ => true
  | _ :: _, [] => false
  | a :: as, b :: bs =>
    if a.toNat < b.toNat then true else if a.toNat = b.toNat then strLt as bs else false

def strLe (a b : List Char) : Bool := !(strLt b a)

/-! ## Callbacks with an index argument (`map((x, i) => ..)` etc.) -/

def mapIdxFrom {α β : Type} (f : α → Int → β) : List α → Int → List β
  | [], _ => []
  | x :: xs, i => f x i :: mapIdxFrom f xs (i + 1)

def mapI {α β : Type} (f : α → Int → β) (xs : List α) : List β := mapIdxFrom f xs 0

def filterIdxFrom {α : Type} (p : α → Int → Bool) : List α → Int → List α
  | [], _ => []
  | x :: xs, i => if p x i then x :: filterIdxFrom p xs (i + 1) else filterIdxFrom p xs (i + 1)

def filterI {α : Type} (p : α → Int → Bool) (xs : List α) : List α := filterIdxFrom p xs 0

def foldlIdxFrom {α β : Type} (f : β → α → Int → β) : β → List α → Int → β
  | acc, [], _ => acc
  | acc, x :: xs, i => foldlIdxFrom f (f acc x i) xs (i + 1)

def foldlI {α β : Type} (f : β → α → Int → β) (init : β) (xs : List α) : β := foldlIdxFrom f init xs 0

/-! ## Loop results -/

/-- Result of a loop that contains `return`: either the function returned (`ret`) or the loop finished with state. -/
inductive Flow (ρ σ : Type) where
  | ret : ρ → Flow ρ σ
  | next : σ → Flow ρ σ
  deriving Repr

/-! ## The checked twin (`rangeOk`)

`<fn>_chk` mirrors the model's control structure in `Chk` and stops at the first JavaScript operation that leaves the
model's total semantics. `rangeOk` is "it did not stop with `range`", `asciiOk` is "it did not stop with `ascii`".
A `thrown` stop is the function's own `throw`: the JavaScript execution ends there too. -/

inductive Fail where
  | thrown (msg : String)
  | range (detail : String)
  | ascii (detail : String)
  deriving Repr

abbrev Chk := Except Fail

def ck (b : Bool) (detail : String) : Chk Unit := if b then pure () else throw (.range detail)
def ckAscii (s : List Char) (detail : String) : Chk Unit := if isAscii s then pure () else throw (.ascii detail)

def rangeOkOf {α : Type} (r : Chk α) : Bool :=
  match r with
  | .error (.range _) => false
  | _ => true

def asciiOkOf {α : Type} (r : Chk α) : Bool :=
  match r with
  | .error (.ascii _) => false
  | _ => true

/-- Lift a throwing model step into `Chk`. -/
def liftThrow {α : Type} (r : Except String α) : Chk α :=
  match r with
  | .ok v => pure v
  | .error m => throw (.thrown m)

def mapIdxFromM {α β : Type} (f : α → Int → Chk β) : List α → Int → Chk (List β)
  | [], _ => pure []
  | x :: xs, i => do
    let y ← f x i
    let ys ← mapIdxFromM f xs (i + 1)
    pure (y :: ys)

def mapIM {α β : Type} (f : α → Int → Chk β) (xs : List α) : Chk (List β) := mapIdxFromM f xs 0

def filterIdxFromM {α : Type} (p : α → Int → Chk Bool) : List α → Int → Chk (List α)
  | [], _ => pure []
  | x :: xs, i => do
    let b ← p x i
    let ys ← filterIdxFromM p xs (i + 1)
    pure (if b then x :: ys else ys)

def filterIM {α : Type} (p : α → Int → Chk Bool) (xs : List α) : Chk (List α) := filterIdxFromM p xs 0

def foldlIdxFromM {α β : Type} (f : β → α → Int → Chk β) : β → List α → Int → Chk β
  | acc, [], _ => pure acc
  | acc, x :: xs, i => do
    let acc' ← f acc x i
    foldlIdxFromM f acc' xs (i + 1)

def foldlIM {α β : Type} (f : β → α → Int → Chk β) (init : β) (xs : List α) : Chk β := foldlIdxFromM f init xs 0

/-! ## JSON output (the `Val` domain of contracts.ts) -/

def jInt (n : Int) : Json := toJson n
def jBool (b : Bool) : Json := toJson b
def jStr (s : List Char) : Json := Json.str (String.ofList s)
def jList {α : Type} (f : α → Json) (xs : List α) : Json := Json.arr (xs.map f).toArray
def jOpt {α : Type} (f : α → Json) : Option α → Json
  | none => Json.null
  | some v => f v

/-- `{"tag":"ok","value":v}` -/
def outOk (v : Json) : String := (Json.mkObj [("tag", Json.str "ok"), ("value", v)]).compress

/-- `{"tag":"throw","message":m}` -/
def outThrow (m : String) : String := (Json.mkObj [("tag", Json.str "throw"), ("message", Json.str m)]).compress

def showPure {α : Type} (enc : α → Json) (v : α) : String := outOk (enc v)

def showExcept {α : Type} (enc : α → Json) (r : Except String α) : String :=
  match r with
  | .ok v => outOk (enc v)
  | .error m => outThrow m

end Faithful

/-- `0 < xs.length` from a length guard (`omega`) or from a hypothesis `¬ xs = []` (a `s !== ""` guard) or
`¬ [] = xs` (a `"" !== s` guard, literal on the left), or, when the guard is one part of a compound condition,
from `xs = []` contradicting the hypotheses (`subst`, then `simp_all`). The last alternative only closes the goal or
fails; it never changes what the model means. -/
macro "faithful_len_pos" : tactic =>
  `(tactic| first
      | omega
      | exact Faithful.length_pos_of_ne_nil (by assumption)
      | exact Faithful.length_pos_of_nil_ne (by assumption)
      | exact Faithful.length_pos_of_eq_nil_false (fun hnil => by subst hnil; simp_all))

/-- Decreasing-proof tactic used by generated `decreasing_by` clauses. -/
macro "faithful_decreasing" : tactic =>
  `(tactic| all_goals first
      | (simp_wf; done)
      | (simp_wf; omega)
      | omega
      | decreasing_tactic)

/-- Unfold `let`-bound guards into the hypotheses (red-team round 2, r2RecGuardBoolLocal). A guard such as
`const done = n <= 0; if (done) ...` reaches `decreasing_by` as `h : ¬ done = true` with `done : Bool := decide (n ≤ 0)`
a let variable, which `omega` cannot see through. `zetaDelta` substitutes let variables; the lemmas turn
`decide`/`&&`/`||`/`!` on `Bool` into propositions (`h : ¬ n ≤ 0`). Emitted first in `decreasing_by` only when a
guard of a recursive call mentions a let-bound name. It only rewrites hypotheses and the goal; a failure is ignored. -/
macro "faithful_unlet" : tactic =>
  `(tactic| all_goals (try simp (config := { zetaDelta := true }) only
      [decide_eq_true_eq, decide_eq_false_iff_not, Bool.and_eq_true, Bool.or_eq_true, Bool.not_eq_true,
       Bool.not_eq_true', Bool.not_eq_false', Decidable.not_not] at *))
