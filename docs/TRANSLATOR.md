# The translator: TypeScript subset v1 to Lean 4

This document describes what `packages/translate` accepts, what Lean it produces for each accepted construct, what it
refuses and why, which preconditions every model carries, and every semantic gap we know of. It is built from
`packages/translate/NOTES.md` (the running decision log), the translator source (`packages/translate/src`), the corpus
report (`packages/engine/scripts/corpus-report.ts`) and the red-team probes (`packages/translate/corpus-redteam`).
`docs/DESIGN.md` and `packages/translate/src/contracts.ts` are the contract; where this document and the contract
differ, the contract wins and this document is wrong.

Written 2026-10-05. Toolchain for every number below unless a section says otherwise: Node v25.8.1 (darwin-arm64),
TypeScript 5.9.3, Lean 4.34.0 (`leanprover/lean4:v4.34.0`), Mathlib `5ed2965256430c3649e86755f9576b54eca72435`.
The translator makes no model call; model id `gpt-6-luna` appears in stamps only because every stamp carries one.

Contents

1. What the translator is (and is not)
2. Pipeline and refusal order
3. Types
4. Constructs: TypeScript to Lean
5. Library: TypeScript to Lean
6. Integers and range semantics (`rangeOk`)
7. Strings and arrays
8. Termination measures
9. Preconditions
10. Refusal codes, each with an example
11. What a translation contains (worked example)
12. Corpus coverage
13. Red-team summary
14. Gaps (plain words)

---

## 1. What the translator is (and is not)

* Deterministic code. `translate(source, fnName)` parses the file with the TypeScript compiler API, checks it, lowers the
  one exported function to an intermediate representation (IR, `ir.ts`), and prints that IR as Lean (`emit.ts`). The
  same IR feeds the SMT encoder (`translateWithIr`). No model call anywhere.
* It either returns a `Translation` (Lean model, preconditions, instrumented TypeScript, notes) or a
  `TranslationRefused` with one `RefusalCode`, a plain-words reason and an exact source span. Refusals are findings,
  not errors: they say "this function is outside subset v1, here is the first reason".
* An accepted translation is a claim that the Lean model computes what the TypeScript function computes **on inputs
  that satisfy the preconditions** (section 9). It is not a claim about inputs outside them, and it is never a claim
  about every possible input of the TypeScript function (DESIGN.md forbids that wording). The claim is tested (differential testing against the
  real original, red-team probes), not proved; see sections 12 and 13 for exactly what was tested.
* Measured speed (NOTES.md, this machine, warm): first `translate()` in a process about 100 ms (lib parse and bind),
  3-4 ms after that. Results are memoized per (fnName, source), 64 entries.

## 2. Pipeline and refusal order

Module map:

| Module | Role |
|---|---|
| `program.ts` | In-memory `ts.Program`: ES2023 lib only (no DOM, no `@types`), `strict`, *not* `noUncheckedIndexedAccess` (so `a[i]: T`). |
| `module.ts` | Module scan: refuses top-level statements that run code when the module loads. |
| `scan.ts` | Feature scan: one pre-order, source-order walk that refuses the "feature" codes. Also `isGlobal`. |
| `types.ts` | Refusal plumbing, exact spans, checker type to subset `Ty`, record registry, Lean name hygiene. |
| `lower.ts` | TypeScript to IR: statement lowering, loops to recursive functions, measure finders, sort comparator reader. |
| `ir.ts` | The IR, `PRIM_DOC` (JavaScript meaning of every primitive), `CHECKED_OPS` (the one table of range checks), the constants `MAX_RECURSION_DEPTH` and `MAX_STRING_LENGTH`. |
| `emit.ts` | IR to Lean: model, checked twin, `rangeOk` / `asciiOk` / `pre`, record structures, JSON encoders. |
| `instrument.ts` | `instrumentedTs` (the original with every checked operation wrapped) and `buildInstrumentedRunner`. |
| `codec.ts` | JSON values to Lean terms, `#eval` expressions, outcome parsing. |
| `translate.ts` | Public API: `translate`, `translateWithIr`, `listExportedFunctions`, `refusalStats`. |

The first, most fundamental refusal wins. The phases run in this order and each stops at its first finding:

1. **Locate.** No top-level function of that name: `not-found` (span 0..0). Present but not exported: `not-found`
   (span = the name). Overloads: `unsupported-syntax`. A function bound with `let`/`var`: `mutable-capture`. The name
   `__faithful` is reserved: `unsupported-syntax`.
2. **Module scan** (`module.ts`): the first top-level statement, in source order, that runs code when the module loads:
   `unsupported-syntax`, span = the statement. Details in section 4.6.
3. **Signature.** `async` / generator: `async`. Type parameters: `generic`. Then each parameter left to right: a `this`
   parameter: `this`; destructuring, rest, default, optional: `unsupported-syntax`; no annotation:
   `missing-annotation`; then its type (section 3). Then the return annotation (missing: `missing-annotation`, span =
   the function name) and its type.
4. **Feature scan** of the body (`scan.ts`), first offending node in source order, outer before inner: `regex`, `date`,
   `map-set`, `nan`, `io`, `random`, `async`, `generic` (explicit type arguments), `bitwise`, `this`, `float`,
   `non-bmp`, `dictionary`, and `missing-annotation` for an unannotated `[]` initializer. A global call such as
   `new Map<K, V>()` reports the global's code (`map-set`), not `generic`.
5. **TypeScript errors.** First, comments that hide diagnostics: a comment anywhere in the file containing
   `@ts-nocheck`, or a comment containing `@ts-ignore` or `@ts-expect-error` that lies in the function statement (its
   leading comments included) or whose next line, the line it suppresses, is a line of the statement:
   `unsupported-syntax`, span = the comment (red-team round 4; matched anywhere in the comment text,
   which is broader than TypeScript's own rule and therefore never misses a directive). Then TypeScript errors whose
   start lies inside the function statement: `unsupported-syntax` ("the function does not type-check: TS<code> ..."),
   span = the diagnostic. Without a type-correct function the checker types the translator relies on are not
   trustworthy.
6. **Lowering**, in source order; a loop's measure is checked at its header before its body is lowered:
   `unsupported-syntax`, `unsupported-library`, `unsupported-type`, `missing-annotation`, `mutable-capture`,
   `no-termination-measure`, and, for a module constant the function reads, `non-bmp` (a string constant) and
   `unsupported-syntax` (a TypeScript error or a `@ts-ignore` / `@ts-expect-error` comment in its statement).

Spans are UTF-16 offsets from the node's first token (leading trivia excluded) to its end; `line` and `column` are
1-based. The refusal tests check the exact span text of every case (`refusals.test.ts`).

## 3. Types

Every parameter and the return type must be annotated. Local variable types come from the TypeScript checker.

| TypeScript | Subset `Ty` | Lean | JSON `Val` |
|---|---|---|---|
| `number` | `int` | `Int` | number (integer, \|n\| <= 2^53) |
| `boolean` | `bool` | `Bool` | boolean |
| `string` | `string` | `List Char` (BMP; one `Char` per UTF-16 unit) | string |
| `T[]`, `Array<T>`, `readonly T[]` | `array` | `List T` | array |
| `[A, B, ...]` (2 or more elements, no optional/rest) | `tuple` | right-nested `A × B × ...` | flat array |
| object type / interface / type alias of a plain record | `record` | one Lean `structure` per shape | object with the declared field names |
| `T \| null`, `T \| undefined`, **only as the whole return type** | `option` | `Option T` | `null` or the inner value |
| a union of literal types of one kind (`1 \| 2`, `"a" \| "b"`) | `int` / `string` | `Int` / `List Char` | as above |

Details:

* Record structures are named after the interface or alias when there is one (capitalized), `Rec<n>` otherwise, never
  the function's own name. Records with identical shapes share one structure (TypeScript is structural). Field names
  that clash with Lean-generated names (`mk`, `rec`, `casesOn`, ...) get a `_` suffix; the empty field name `""` gets
  the Lean name `v`; JSON keys always keep the TypeScript name.
* A number literal type must be an integer within ±2^53: `0.5` or `1 | 2.5` is `float`; `1e300` is `unsupported-type`.
* Refused (`unsupported-type` unless noted): `any`, `unknown`, unions of different types, `T | null` anywhere except the
  whole return type (this includes local variables: `let best: number | null = null` is refused), intersections,
  enums, `bigint`, `symbol`, template literal types, function types (functions as values), optional fields, methods
  and accessors, recursive record types, 0- and 1-element tuples, tuples with optional or rest elements, empty object
  types, a record field named `__proto__`, `void`/`never`; index signatures, `Record<K, V>` and mapped types
  (`dictionary`); `Map`, `Set`, `WeakMap`, `WeakSet`, `ReadonlyMap`, `ReadonlySet` (`map-set`); `Date` (`date`);
  `RegExp` (`regex`); `Promise` (`async`); a generic type parameter (`generic`).

## 4. Constructs: TypeScript to Lean

All Lean below lives in `namespace Model` of a file that starts with `import Faithful.Core` (no Mathlib). The runtime
helpers named `Faithful.*` are defined in `lean/Faithful/Core.lean`.

### 4.1 Declarations, values, operators

| TypeScript | Lean | Notes |
|---|---|---|
| `export function f(p: T, ...): R { ... }` | `def f (p : T) ... : R` (or `: Except String R` when the body can throw) | `const f = (...) => ...` and `const f = function ...` too. Exactly one function per translation. |
| `const x = e;` / `let x = e;` | `let x := e` (SSA: each assignment is a fresh `let x_1 := ...`) | Initializer required. `var` refused. Destructuring refused. |
| `x = e`, `x += e`, `x -= e`, `x *= e`, `x %= e`, `x++`, `x--` (as statements) | a fresh `let` | `/=` is `float`; `**=`, `??=`, `\|\|=`, `&&=`, shift and bitwise assignments refused. `++`/`--` inside an expression refused. Assignment inside an expression refused. |
| integer literal | `(n : Int)` | Must be exactly representable and within ±2^53, else `unsupported-syntax`; non-integer literal: `float`. |
| `true`, `false` | `true`, `false` | |
| string literal, template without substitutions | `List Char` literal `['a', 'b']` | Must be BMP text without lone surrogates (`non-bmp`). |
| template literal `` `a${x}b` `` | left-nested `++`, numbers via `Faithful.intToStr`, booleans via `Faithful.boolToStr` | One length check on the whole result (section 7). Arrays/records in a template refused. Tagged templates refused. |
| `a + b`, `a - b`, `a * b`, `-a` on numbers | `a + b`, `a - b`, `a * b`, `-a` on `Int` | `+ - *` results are range-checked (section 6). |
| `a % b` | `Int.tmod a b` | Never Lean `%`. Divisor checked non-zero. |
| `s + t` with a string operand | `s ++ t` (the other operand converted with `intToStr` / `boolToStr`) | Arrays/records in string context refused. |
| `a === b`, `a !== b` (also `==`, `!=`) | `decide (a = b)` / `decide (a ≠ b)` | Only between two values of the same primitive type. On arrays, tuples, records (reference comparison in JS): refused. With `null`/`undefined`: refused. |
| `a < b`, `<=`, `>`, `>=` | `decide (a < b)` on `Int`; `Faithful.strLt` / `Faithful.strLe` on strings | Two numbers or two strings only. |
| `a && b`, `a \|\| b`, `!a` | `&&`, `\|\|`, `!` on `Bool` | Booleans only (JS `&&`/`\|\|` return an operand). Short-circuit kept. |
| `c ? a : b` | `if c then a else b` | Branches must have one type. |
| `x!`, `e satisfies T` | identity | No runtime effect. |
| `[a, b]` as an array | `[a, b]` | Spread and holes refused. |
| `[a, b]` as a tuple | `(a, b)` | Length and element types must match the tuple type. |
| `{ f: a, g: b }` | structure literal | Every field set, no extras, no spread, no computed keys, methods or accessors. |
| `r.f` | field projection | |
| `t[0]`, `t[1]` on a tuple | projection | Literal index only. |
| `xs[i]` | `Faithful.getD xs i` | Index checked in bounds (section 6). |
| `s[i]` on a string | `Faithful.strAt s i` | Index checked in bounds. |
| `xs.length`, `s.length` | `(xs.length : Int)` | A tuple's `.length` is its literal length. |

### 4.2 Control flow

| TypeScript | Lean |
|---|---|
| `if (c) { ... } else { ... }` without jumps | `if c then ... else ...`, then the variables both branches may modify are re-bound (a `state` tuple) |
| `if` containing `return` / `throw` / `break` / `continue` | the rest of the block is duplicated into each branch that falls through (bounded: more than 40,000 IR nodes is refused, `unsupported-syntax` "control flow too complex") |
| `return e` | the value; `some e` in an option-returning function; in a function that can throw, the body is a `do` block of type `Except String R` and the value is `pure e` |
| `return null`, `return undefined`, `return;`, falling off the end (option return) | `none` |
| `throw new Error("lit")`, `throw Error("lit")`, `throw "lit"` | `throw "lit"` inside the `Except String R` `do` block (a Lean `String` message, the literal exactly) |
| `for (init; cond; incr) body`, `while (cond) body` | a separate recursive function `Model.f_loop<k>` whose parameters are the captured read-only variables and the loop-carried variables; body = `if cond then <body> else <exit state>`; `termination_by` the measure found (section 8) |
| `for (const x of xs) body` | `Model.f_loop<k>` matching on the remaining list: `[] => exit`, `x :: rest => body` (structural) |
| `continue` | run the incrementor, then the recursive call (exactly JavaScript's unlabeled `continue`) |
| `break` | return the current loop-carried state |
| `return` inside a loop | `Faithful.Flow.ret v` (normal exit is `Faithful.Flow.next state`); the caller matches on `.ret r` / `.next _` |
| self-call `f(a, b)` | `Model.f a b` with `termination_by` (section 8) |

Refused (`unsupported-syntax`): labels (labeled `break`/`continue` included), `do...while`, `for...in`, `for await`
(`async`), `switch`, `try`/`catch`, nested function declarations, classes, `var`, `for...of` over a string,
`for...of` without a declared loop variable or with destructuring, a function whose control can reach the end without
returning (unless the return type is an option), `return` without a value in a non-option function, `void`,
expression statements other than assignments and `++`/`--` ("this statement has no effect in a pure function"),
`throw` of anything other than a literal message, `throw` inside a callback, other `Error` classes
(`RangeError`, ...).

Why `break`/`continue` are sound: inside the loop function the continuation is explicit. Falling off the end of the body
and `continue` both run the incrementor and then recurse; `break` returns the current state; `return` leaves through
`Flow.ret`. That is exactly JavaScript's semantics for unlabeled `break`/`continue` in `for`, `while` and `for...of`.

### 4.3 Calls and functions

* **No calls to other user-defined functions.** A call to any function declared in the same file other than the
  translated function itself: `unsupported-syntax`, "calls to other functions are outside subset v1". A function used
  as a value: `unsupported-syntax`.
* **Self-recursion** is supported (section 8), but not inside loops or callbacks (`no-termination-measure`).
* **Callbacks** are accepted only as inline arrow functions or function expressions passed to `map`, `filter`,
  `reduce` and `sort`. They take `(x)` / `(x, i)` (map, filter) or `(acc, x)` / `(acc, x, i)` (reduce); the third
  "array itself" parameter is refused (`unsupported-library`). A `this` pseudo-parameter together with other parameters
  is refused (`this`); a callback whose only parameter is `this` is kept (it ignores its arguments and cannot read
  `this`). Default, rest and destructured callback parameters are refused. `filter` callbacks must return a boolean.
  Callbacks may contain loops, but not `throw` and not a self-call.

### 4.4 Closures and module-level bindings

* A callback may read parameters and variables that are never reassigned. Reading a reassigned `let` (including a loop
  counter) is `mutable-capture` (strict reading of "no closures over mutable state": sound, conservative). A callback
  that assigns a variable of the enclosing function: `mutable-capture`.
* A module-level `const NAME = <number | string | boolean literal>` the function reads is inlined into the model and its
  statement is copied verbatim into `instrumentedTs` and `plainTs`. Every declarator of that statement must be a literal.
  Any other module-level binding the function reads: `mutable-capture`. (Value imports never get this far: the module
  scan refuses them first, section 4.6.) The statement must have no TypeScript error and no `@ts-ignore` /
  `@ts-expect-error` comment (`unsupported-syntax`): `const K = 010`, `09`, `"a\1b"` and `1__0` are errors in
  TypeScript and SyntaxErrors in a strict ES module, which then never loads, while their sloppy-mode value would be
  inlined (red-team round 4). A constant the function does not read is not checked (`r4ModuleOctalConst` is accepted;
  see Gaps, "Unloadable module").
* `__faithful` is reserved for the instrumentation runtime as the function's own name or a module constant's name.

### 4.5 Builtins are resolved by declaration, not by spelling

`Math.*`, `undefined`, `Error` and the `Number.` / `String.` / ... refusals apply to the builtin only when every
declaration of the name lies outside the user's file (`isGlobal` in `scan.ts`; interface merges are ignored). A
module-level `const Math = { floor: ... }` is therefore an ordinary module binding and is refused as `mutable-capture`,
not modeled as `Int.fdiv` (red-team round 2, `moduleMathShadow`).

### 4.6 Module scan

Every top-level statement of the file must be inert: evaluating it at module load runs no user code. Allowed: function
declarations, interfaces, type aliases, empty statements, string directives, anything `declare`d, namespaces of types
only, type-only imports, `export { a }` without a module specifier, `export type ... from`, enums with literal
initializers, `const`/`let`/`var` with identifier names whose initializers are inert (literals and operators over
literals, identifiers, arrow/function expressions, regex literals, array/object literals of inert values without spread
and without non-literal computed keys), `export default <inert>`. Refused (`unsupported-syntax`, span = the
statement): expression statements (for example `Math.floor = (x) => x;`), classes, value imports and re-exports from
another module, `import x = ...`, `using` / `await using`, destructuring declarations, any other statement.
(Red-team round 2, `mathFloorPatched` / `mathAbsPatched`.)

## 5. Library: TypeScript to Lean

Anything not listed is refused, normally as `unsupported-library` (the code `float`, `nan`, `random`, `io` etc. where the
feature scan catches it first).

| TypeScript | IR primitive (`PRIM_DOC`) | Lean | Check (`CHECKED_OPS`) |
|---|---|---|---|
| `Math.floor(a / b)` | `fdiv` | `Int.fdiv a b` | divisor non-zero |
| `Math.ceil(a / b)` | `cdiv` | `Faithful.cdiv a b` = `-(Int.fdiv (-a) b)` | divisor non-zero |
| `Math.floor(x)`, `Math.ceil(x)` of an integer expression | identity | `x` | none |
| `Math.abs(a)` | `abs` | `Faithful.iabs a` (`(Int.natAbs a : Int)`) | none (cannot leave ±2^53) |
| `Math.min(a, b, ...)`, `Math.max(...)` (1 or more arguments) | `min` / `max` | nested `Min.min` / `Max.max` | none |
| `s.length` | `strLen` | `(s.length : Int)` | none |
| `s.charAt(i)` | `charAt` | `Faithful.charAt s i` (`""` out of range, as JS) | none |
| `s.charCodeAt(i)` | `charCodeAt` | `Faithful.charCodeAt s i` | index in bounds |
| `s[i]` | `strAt` | `Faithful.strAt s i` | index in bounds |
| `s.slice()`, `s.slice(a)`, `s.slice(a, b)` | `strSliceFrom` / `strSlice` | `Faithful.sliceFrom` / `Faithful.slice` (JS negative-index and clamping rules) | none |
| `s.indexOf(t)`, `s.indexOf(t, pos)` | `strIndexOf` | `Faithful.strIndexOf s t pos` | none |
| `s.split(sep)` (one string argument) | `split` | `Faithful.split s sep` | none |
| `xs.join()`, `xs.join(sep)` on `string[]`, `number[]`, `boolean[]` | `join` (numbers/booleans mapped through `intToStr` / `boolToStr`) | `Faithful.join` | result length <= `MAX_STRING_LENGTH` |
| `s.toLowerCase()`, `s.toUpperCase()` | `toLower` / `toUpper` | `Faithful.toLower` / `Faithful.toUpper` (ASCII letters only) | argument is ASCII (`ascii` precondition) |
| `s + t`, `s += t`, template literals | `strConcat` | `++` | result length <= `MAX_STRING_LENGTH` |
| `String` conversion of a number/boolean in `+` or a template | `intToStr` / `boolToStr` | `Faithful.intToStr` / `Faithful.boolToStr` | none |
| `xs.length` | `len` | `(xs.length : Int)` | none |
| `xs[i]` | `at` | `Faithful.getD xs i` | index in bounds |
| `xs.slice()`, `xs.slice(a)`, `xs.slice(a, b)` | `sliceFrom` / `slice` | `Faithful.sliceFrom` / `Faithful.slice` | none |
| `xs.concat(ys, ...)` with every argument of exactly the receiver's array type | `concat` | `xs ++ ys` | none |
| `xs.indexOf(x)`, `xs.includes(x)` on number/boolean/string elements, no start index | `indexOf` / `includes` | `Faithful.indexOf` / `Faithful.includes` | none |
| `xs.map(x => e)`, `xs.map((x, i) => e)` | `map` / `mapI` | `List.map` / `Faithful.mapI` | checks inside, per element |
| `xs.filter(x => p)`, `xs.filter((x, i) => p)` | `filter` / `filterI` | `List.filter` / `Faithful.filterI` | checks inside, per element |
| `xs.reduce((acc, x) => e, init)`, `(acc, x, i)` | `foldl` / `foldlI` | `List.foldl` / `Faithful.foldlI` | checks inside, per element |
| `fresh.sort(cmp)` (section 7) | `sortBy` | `List.mergeSort xs (fun a b => key a ≤ key b)` | none (comparators are not instrumented) |

Refused examples (all `unsupported-library` unless noted): `Math.trunc`, `Math.sign`, `Math.imul`, `Math.clz32`,
`Math.min()` / `Math.max()` with no arguments (they are ±Infinity); `Math.round`, `Math.sqrt`, `Math.pow` and the other
floating-point `Math` members, `toFixed`, `toPrecision` (`float`); `Math.random`, `crypto` (`random`); `parseInt`,
`Number(...)`, `String(...)`, `Number.*`, `String.*`, `Array.*`, `Object.*`, `JSON.*`; string `includes`, `startsWith`,
`endsWith`, `trim`, `replace`, `substring`, `repeat`, `padStart`, `at`, `codePointAt`, `localeCompare`, `normalize`,
`lastIndexOf`, `toString`; `split()` without a separator or with a limit; array `push`, `pop`, `splice`, `reverse`,
`fill` and every other mutator, `find`, `some`, `every`, `flat`, `reduceRight`, `toSorted`, `toReversed`, `with`,
`forEach`; `reduce` without an initial value; `new Array(...)`; `concat` with an element-typed argument
(`unsupported-syntax`); `indexOf` / `includes` on arrays of arrays, tuples or records (reference comparison,
`unsupported-syntax`).

## 6. Integers and range semantics (`rangeOk`)

`number` is modeled as Lean `Int` (unbounded) under the precondition that every number the original computes is an
integer in [-2^53, 2^53] (inclusive; `MAX_SAFE` = 2^53 = 9007199254740992 in `contracts.ts`).

| TypeScript | Lean | Why |
|---|---|---|
| `a + b`, `a - b`, `a * b` | `+ - *` on `Int` | exact on integers; the range check guarantees the JS double is exact too |
| `a % b` | `Int.tmod a b` | JS `%` is truncated (sign of the dividend): `-7 % 3 === -1`. Lean `%` on `Int` is Euclidean (`-7 % 3 = 2`). Never emitted. |
| `Math.floor(a / b)` | `Int.fdiv a b` | the only accepted division pattern |
| `Math.ceil(a / b)` | `-(Int.fdiv (-a) b)` | |
| bare `a / b`, `/=` | refused, `float` | not provably integer-valued |
| `Math.abs`, `Math.min`, `Math.max` | `Int.natAbs`-based abs, `Min.min`, `Max.max` | |

Why `Math.floor(a / b)` computed with doubles equals `Int.fdiv a b` for |a|, |b| <= 2^53 and b != 0: the rounded quotient
is (a/b)(1+d) with |d| <= 2^-53. Rounding can carry the quotient across an integer only if the distance from a/b to the
next integer (at least 1/|b|) is at most |a/b|·2^-53, which needs |a| >= 2^53; at |a| = 2^53 the tie cases need b to be a
power of two, where the division is exact. This argument is checked by a fast-check property (20,000 edge-weighted
samples, including ±2^53 neighbourhoods) against BigInt floor/ceil division, together with `%` against BigInt truncated
remainder (`translate.test.ts`). It is a tested argument, not a Lean proof.

`-0`: JavaScript produces `-0` from `a * 0` with negative `a`, from `Math.ceil` of a small negative quotient and from `%`
of a negative dividend. In subset v1 it is unobservable (ToString, `===`, `join`, `indexOf`, `includes`, `min`/`max` all
treat it as 0, and a `-0` divisor fails the nonzero check on both sides, so such inputs are excluded by `range-ok`:
`range-violation` in the instrumented original, `rangeOk` false in Lean). This is what red-team probes
`r4NegZeroInvisible` and `r4NegZeroDivisor` held; it is not proved.

### The range-check twin

`rangeOk` is a second, mechanical interpretation of the same IR. DESIGN.md describes it as `<name>_ok : ... -> Bool`;
what is emitted instead (same intent, documented deviation):

* `Model.<fn>_chk : ... -> Faithful.Chk τ` (an `Except Faithful.Fail`), the same control structure as the model in
  A-normal form, with one `Faithful.ck (condition) "message"` line before every checked operation, stopping at the first
  failed check or at the function's own `throw` (where JavaScript stops too). Loops become `_loop<k>_chk` functions with
  the same termination measures.
* `Model.<fn>_rangeOk args := Faithful.rangeOkOf (Model.<fn>_chk args)` (a `Bool`), and `Model.<fn>_asciiOk` likewise
  when the function case-maps.
* `Model.<fn>_pre args` = int-bound && bmp && rangeOk && asciiOk (only the parts that apply).

Reasons for the twin shape: recursion results flow through it without re-running the model (no exponential blow-up),
and it doubles as a checked interpreter whose value the tests compare with the model.

The checks (`CHECKED_OPS` in `ir.ts`; the twin and the TypeScript instrumentation read this one table, and the
TypeScript nodes to wrap are read off the final IR, so both sides check the same operations in the same order):

| Check kind | Operations | Condition |
|---|---|---|
| `range` | `+`, `-`, `*` (including `+=`, `-=`, `*=`, `++`, `--`) | result within ±2^53 inclusive, computed exactly |
| `nonzero` | `%`, `Math.floor(a / b)`, `Math.ceil(a / b)` | divisor is not 0 |
| `bounds` | `xs[i]`, `s[i]`, `s.charCodeAt(i)` | 0 <= i < length |
| `ascii` | `toLowerCase`, `toUpperCase` | every character of the receiver is below 128 |
| `length` | string `+`, `+=`, the whole of a template literal, `join` | result has at most `MAX_STRING_LENGTH` = 2^24 = 16,777,216 UTF-16 units |
| depth | every self-call of a recursive function | the calling activation has depth < `MAX_RECURSION_DEPTH` = 500 (the top-level call has depth 1), i.e. at most 500 activations live |

Not checked because they cannot leave the model: unary minus, `abs`, `min`/`max`, `.length`, `indexOf`, `slice`,
`charAt`, `split`, case maps (same length), number/boolean to string. Checks run in JavaScript evaluation order,
inside callbacks per element (`List.mapM` / `filterM` / `foldlM` and the `Faithful.*IM` index variants in the twin),
never inside sort comparators.

On the TypeScript side `instrumentedTs` wraps each checked operation in a call on `__faithful` (`add`, `sub`, `mul`,
`mod`, `floorDiv`, `ceilDiv`, `at`, `charCodeAt`, `lower`, `upper`, `concat`, `template`, `join`, `rec`,
`userThrow`); each helper computes exactly the JavaScript operation it replaces and reports `range-violation` when its
check fails. The range helpers are exact: |r| < 2^53 is trusted (if the true value had |v| >= 2^53 the rounded result
would too), at |r| = 2^53 exactness is checked with BigInt (2^53 + 1 rounds to 2^53 and is a violation).
`Number.isSafeInteger` is never used (it means < 2^53, not <= 2^53).

Why D = 500 (measured 2026-10-05, Node v25.8.1, macOS arm64; first depth at which a call faults with stack overflow):
simple `1 + f(n - 1)`: plain Node main thread about 9,400, instrumented runner on the main thread about 3,100, sandbox
worker (4 MB stack) instrumented about 12,500; a frame-heavy function (40 locals, a `map` callback and string operations
per level): plain about 2,150, instrumented main thread about 790, sandbox instrumented about 3,100. D is below the
smallest of these.

Why L = 2^24 (measured 2026-10-05, Node v25.8.1, Lean 4.34.0): V8 rejects strings longer than 2^29 - 24 units, so L
must be below that, and the Lean twin must be able to evaluate up to L because the harness checks `rangeOk = false` on
inputs that cross it. `#eval` of a checked doubling loop, net of the 0.22 s import: 2^20 under 0.05 s, 2^24 about
0.4 s, 2^26 about 2.5 s.

## 7. Strings and arrays

### Strings

* A string is `List Char` restricted to the Basic Multilingual Plane: one `Char` per UTF-16 code unit. `s.length` is the
  UTF-16 unit count, which equals the `Char` count only for BMP text. Astral characters (surrogate pairs) and lone
  surrogates are outside the model: string arguments carry the `bmp` precondition, and string literals and module
  string constants with a surrogate are refused (`non-bmp`).
* `s < t` (and `<=`, `>`, `>=`) is lexicographic by code unit (`Faithful.strLt` / `strLe`); for BMP text code units are
  code points, so this is `Char` order.
* `charAt` out of range is `""`, as in JavaScript. `s[i]` out of range is `undefined` and `charCodeAt(i)` out of range is
  NaN in JavaScript; both are excluded by `rangeOk`. The model reads `Faithful.getD` (an arbitrary default) and
  `charCodeAt` returns 0 there; specifications must not rely on those values.
* `indexOf(sub, pos)`: `pos` clamped to [0, length]; an empty `sub` is found at the clamped position.
* `split(sep)` (one argument, no limit, no regex): empty separator gives one string per unit (`"".split("")` is `[]`);
  `"".split(",")` is `[""]`; left-to-right, non-overlapping matches.
* `join(sep?)` on `string[]`, `number[]` (via `intToStr`), `boolean[]`; default separator `","`.
* Number to string (`+` with a string, templates, `join`) uses `Faithful.intToStr`, exact for |n| <= 2^53 (JavaScript
  uses exponent notation only from 1e21).
* `toLowerCase` / `toUpperCase` map ASCII letters only (see Gaps). Every string that reaches one must be ASCII: the
  `ascii` precondition, checked by the twin on every string that reaches a case map (not only parameters).
* Helper semantics are checked against Node on an edge-case grid (`runtime.test.ts`: slice with indices -7..6 on
  strings and arrays, indexOf at every position, split edge cases, join, intToStr, ASCII case maps, tmod/fdiv/cdiv
  signs, strLt/strLe, charCodeAt).

### Arrays

* Arrays are immutable Lean `List`s. Mutators (`push`, `pop`, `splice`, `reverse`, `fill`, ...) are refused
  (`unsupported-library`); element and field assignment, element increment and `length` assignment are refused
  (`unsupported-syntax`).
* `xs[i]` out of range is excluded by `rangeOk`; the model reads `Faithful.getD`.
* `concat` only with arguments of exactly the receiver's array type: JavaScript spreads array arguments and appends
  others, so an element-typed argument is refused.
* `indexOf` / `includes` only on number, boolean or string elements (`===` on primitives), without a start index.

### Sort

* `List.mergeSort` is stable, and JavaScript's `Array.prototype.sort` is stable since ES2019. For a comparator that is a
  consistent total preorder on keys, the stable sorted result is unique, so the two agree.
* The receiver must be a fresh array that no other live reference can see, because `sort` mutates its receiver. Fresh:
  array literals; results of `slice`, `concat`, `map`, `filter`, `split`; `sort` of a fresh receiver; a conditional with
  fresh branches; a self-call when every `return` of the function returns a fresh value. Not fresh: variables (so
  `xs.sort(...)` is refused with the hint `xs.slice().sort(...)`), `reduce` results, any other call.
* Accepted comparators (inline, exactly two named parameters, no `this`): `(a, b) => K(a) - K(b)` (ascending),
  `(a, b) => K(b) - K(a)` (descending) for numeric keys; nested conditionals over `<`, `<=`, `>`, `>=`, `===`, `!==` of
  `K(a)` and `K(b)` with literal results, for numeric or string keys, provided the comparator gives 0 for equal keys and
  opposite non-zero signs otherwise (the translator evaluates its sign for the three orders of the keys). `K(x)` is `x`,
  `x.f`, `x[literal]` or a chain of those.
* Plain `.sort()` only on `string[]` (on numbers JavaScript compares decimal strings): ascending by code unit.
* Lean: `List.mergeSort xs (fun a b => decide (key a ≤ key b))` for numeric keys, `Faithful.strLe` for string keys, with
  the arguments swapped for descending order.
* Comparators are not instrumented: V8 and merge sort compare different pairs, and the sign of `a - b` is exact for
  integers within ±2^53 even when the difference itself is not.

## 8. Termination measures

Every loop and every recursive function needs a measure the translator can find; otherwise it refuses with
`no-termination-measure`. The measure becomes `termination_by <measure>` with `decreasing_by` hints
(`Faithful.fdiv_lt_self`, `Faithful.sliceFrom_length_lt`) followed by `faithful_decreasing` (`simp_wf` / `omega` /
`decreasing_tactic`). No `sorry`, `partial` or `unsafe` is ever emitted, and the Lean tests check the axioms of every
emitted definition (tier `proved`).

### Loops (`findLoopMeasure`)

The condition is split on `&&`; the first conjunct that matches one of these patterns wins.

| Pattern | Example | Measure |
|---|---|---|
| `for...of` | `for (const x of xs)` | structural, over the remaining list |
| Counting up: `v < E` or `v <= E` with `v` increased by a positive literal step | `for (let i = 0; i < n; i++)`, `i += 2` | `(E - v).toNat` (`+1` for `<=`) |
| Counting down: `v > E` or `v >= E` with `v` decreased by a positive literal step | `for (let i = n; i >= 0; i -= 2)` | `(v - E).toNat` (`+1` for `>=`) |
| Halving: `v > c` (c >= 0) or `v >= c` (c >= 1), c a literal, with `v = Math.floor(v / k)`, k >= 2 a literal | `while (i > 0) { i = Math.floor(i / 2); }` | `(v - c).toNat` (`+1` for `>=`) |
| Shrinking array: `xs.length > 0` (or `>= 1`, `!== 0`, `!= 0`, either operand order) with `xs = xs.slice(k)`, k >= 1 | `while (r.length > 0) { r = r.slice(1); }` | `xs.length` |
| Shrinking string: `s !== ""` or `s != ""` (either operand order) with `s = s.slice(k)`, k >= 1 | `while (r !== "") { r = r.slice(1); }` | `s.length` |

Conditions on the update: `E` must be loop-invariant (no loop variable, nothing declared inside the loop, no
assignment, no self-call). `v` must be updated exactly once: either only by the `for` incrementor, or by one top-level
statement of the body, and then the body must have no `continue` of its own (a `continue` could skip the update).
`v++`, `v += k`, `v = v + k`, `v = k + v` and the mirror images count; `Math.floor(v / k)` halves; `v.slice(k)` shrinks.

Not recognized (refused, findings): binary search style `lo <= hi` with `lo`/`hi` updated in branches (interval
measure), two loop variables moving toward each other (`i < j` with `i++` and `j--`), loops without a condition
(`for (;;)`, `while (true)`), `while (x !== 0)`, `do...while` (refused as syntax).

### Recursion (`findRecursionMeasure`)

Every self-call is examined under the `if` conditions it sits in (let-bound names inlined). `&&` / `||` whose right
operand contains a self-call are lowered to `if` so the left operand acts as a guard.

| Pattern | Example | Measure |
|---|---|---|
| A number parameter passed as `p - k` (k >= 1) under a guard giving a lower bound `p >= c` | `if (n <= 0) return 0; return n + f(n - 1);` | `(p - c_min + 1).toNat` |
| A number parameter passed as `Math.floor(p / k)` (k >= 2) under `p >= 1` | `if (n < 1) return 0; return 1 + f(Math.floor(n / 2));` | as above |
| An array or string parameter passed as `p.slice(k)` (k >= 1) under a guard implying `p.length >= 1` | `if (s === "") return ""; return f(s.slice(1)) + s.charAt(0);` | `p.length` |

For a string parameter the guard may be `s !== ""` or the else branch of `s === ""` (with the literal on either side).
When a guard mentions a let-bound name (`const done = n <= 0; if (done) ...`), the measure carries `unlet` and
`decreasing_by` starts with `faithful_unlet` (a `simp` with `zetaDelta` and the `decide`/`Bool` connective lemmas only),
so the guard reaches `omega` unfolded (red-team round 2).

Refused (findings): `n === 0` as the only base case (it does not bound `n` from below; negative `n` never stops in
JavaScript either); `gcd`-style `f(b, a % b)` (measure |b|, not a pattern); a measure on a derived value such as
`const m = Math.abs(n)` (only parameters themselves are measured); `Math.ceil(n / 2)` halving under `n >= 2`;
`Math.floor(n / -2)` (only a positive literal k >= 2 is known); recursive calls inside loops or callbacks (they would
need mutual or nested well-founded recursion); mutual recursion (calls to other functions are refused anyway);
lexicographic measures; Ackermann.

## 9. Preconditions

Each `Translation` carries `preconditions: Precondition[]`, each with plain words (shown on the agreement screen), a
Lean `Bool` expression over the parameters and, where possible, a JavaScript expression. `Model.<fn>_pre` is the
conjunction of the ones the translator produced.

| Kind | Produced by | Words (as emitted) | Lean | TypeScript side |
|---|---|---|---|---|
| `int-bound` | translator, when any parameter contains a number | "Every number in the arguments is a whole number between -2^53 and 2^53." | `Faithful.intOk x` per number, through arrays/tuples/records | `(typeof x === "number" && x % 1 === 0 && x >= -2^53 && x <= 2^53)` (operators only, so a parameter named `Math` or `Number` cannot break it; red-team round 3) |
| `bmp` | translator, when any parameter contains a string | "Every string in the arguments is Basic Multilingual Plane text: no emoji or other characters written as two UTF-16 units, and no lone surrogates." | `Faithful.bmp s` (every `Char` below 65536) | a regex-literal test, no globals |
| `range-ok` | translator, always | "Running the original stays inside the model: every intermediate number is a whole number within ±2^53, every array index, string index and charCodeAt position is in range, no division or % is by zero, and no string built by concatenation or join is longer than 16777216 UTF-16 units (JavaScript engines reject very long strings)", plus ", and at most 500 calls of the function are active at once (recursion depth; ...)" for a recursive function | `Model.<fn>_rangeOk args` | no expression: enforced by running `instrumentedTs` (outcome `range-violation`) |
| `ascii` | translator, when the function uses `toLowerCase` / `toUpperCase` | "Every string that reaches toLowerCase/toUpperCase is ASCII (the model changes the case of ASCII letters only)." | `Model.<fn>_asciiOk args` | no expression: the instrumented original reports `range-violation` with detail `ascii check failed ...` |
| `no-throw` | defined in `contracts.ts`; not produced by the translator and, as of 2026-10-05, not produced by any package (grep) | (user choice: treat a `throw` as a precondition) | | |
| `carve-out` | `packages/session`, when the user rules "my function is wrong" and records a carve-out; never by the translator | user-written | user-written | |

## 10. Refusal codes, each with an example

There are 20 codes (`REFUSAL_CODES`). Every example below is a case in `packages/translate/src/refusals.test.ts`, which
checks the code and the exact span text; the spans are quoted. Verified 2026-10-05: 67 of 67 tests pass.

| Code | Meaning | Example source | Span |
|---|---|---|---|
| `float` | non-integer division, floating-point `Math`, non-integer literals, `Infinity`, `parseFloat`, `Math.round` | `export function f(a: number): number { return a / 2; }` | `a / 2` |
| `regex` | regular expressions, `RegExp` | `export function f(s: string): boolean { return /a+/.test(s); }` | `/a+/` |
| `date` | `Date` | `export function f(): number { return Date.now(); }` | `Date` |
| `map-set` | `Map`, `Set`, `WeakMap`, `WeakSet`, `ReadonlyMap`, `ReadonlySet` | `export function f(s: Set<number>): number { return 1; }` | `Set<number>` |
| `dictionary` | index signatures, `Record<K, V>`, mapped types | `export function f(d: Record<string, number>): number { return 1; }` | `Record<string, number>` |
| `nan` | `NaN`, `isNaN`, `Number.NaN`, `Number.isNaN` | `export function f(a: number): number { return a > 0 ? a : NaN; }` | `NaN` |
| `io` | `console`, `process`, `require`, `fetch`, `document`, `window`, `globalThis`, timers, storage, ... | `export function f(a: number): number { console.log(a); return a; }` | `console` |
| `random` | `Math.random`, `crypto` | `export function f(a: number): number { return a + Math.floor(Math.random()); }` | `Math.random` |
| `async` | `async`, `await`, generators, `Promise`, `for await` | `export async function f(a: number): Promise<number> { return a; }` | `async` |
| `generic` | type parameters, explicit type arguments | `export function f<T>(a: T): T { return a; }` | `T` |
| `bitwise` | `\|`, `&`, `^`, `~`, `<<`, `>>`, `>>>` and their assignments | `export function f(a: number): number { return a \| 0; }` | `\|` |
| `this` | `this`, a `this` parameter (function or callback with other parameters, sort comparator) | `export function f(this: { x: number }, a: number): number { return a; }` | `this: { x: number }` |
| `mutable-capture` | module-level state, a callback reading a reassigned variable or assigning an outer one, a function bound with `let`/`var` | `let counter = 0;` then `export function f(a: number): number { return a + counter; }` | `counter` |
| `no-termination-measure` | a loop or recursion with no measure the translator can find | `export function f(x: number): number { while (x !== 0) { x = x - 1; } return x; }` | `x !== 0` |
| `unsupported-type` | types outside section 3 | `export function f(x: number \| null): number { return 1; }` | `number \| null` |
| `unsupported-syntax` | syntax outside subset v1, including calls to other functions, reference equality, truthiness, sorting a non-fresh array, functions that do not type-check, module-level code | `function g(x: number): number { return x; }` then `export function f(x: number): number { return g(x); }` | `g(x)` |
| `unsupported-library` | library members outside section 5 | `export function f(s: string): string { return s.trim(); }` | `trim` |
| `missing-annotation` | parameter or return type without annotation, unannotated `[]` | `export function f(x: number) { return x; }` | `f` |
| `non-bmp` | a string literal or module string constant with an astral character or lone surrogate | `export function f(s: string): string { return s + "😀"; }` | `"😀"` |
| `not-found` | no top-level function of that name, or not exported | `function g(x: number): number { return x; }` translated as `g` | `g` |

More examples from the same test file: `Math.sqrt(a)` and `a + 1.5` are `float`; `xs.push(1)` and `parseInt(s)` are
`unsupported-library`; `x ? true : false` on a number is `unsupported-syntax` (truthiness); `xs.sort((a, b) => a - b)`
on a parameter is `unsupported-syntax` (mutates); `xs.slice().sort()` on numbers is `unsupported-syntax` (compares as
strings); `if (n === 0) return 1; return n * fact(n - 1);` is `no-termination-measure`; a top-level
`Math.floor = (x: number): number => x;` is `unsupported-syntax` (module code).

## 11. What a translation contains (worked example)

Source:

```ts
export function sumTo(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) { s = s + (i % 3); }
  return s;
}
```

Emitted Lean (excerpt; generated 2026-10-05 by the current translator):

```lean
def sumTo_loop1 (n : Int) (s : Int) (i : Int) : (Int × Int) :=
  (if (i < n) then
    (let s_1 := (s + (Int.tmod i (3 : Int)));
     (let i_1 := (i + (1 : Int));
      (Model.sumTo_loop1 n s_1 i_1)))
   else
    (s, i))
termination_by ((n - i)).toNat
decreasing_by
  faithful_decreasing

def sumTo (n : Int) : Int :=
  (let s := (0 : Int);
   (let i := (0 : Int);
    (let (s_1, i_1) := (Model.sumTo_loop1 n s i);
     s_1)))

def sumTo_loop1_chk (n : Int) (s : Int) (i : Int) : Faithful.Chk ((Int × Int)) :=
  do
    if (i < n) then
      Faithful.ck (decide ((3 : Int) ≠ 0)) "nonzero check failed at line 3: i % 3"
      Faithful.ck (Faithful.inRange (s + (Int.tmod i (3 : Int)))) "range check failed at line 3: s + (i % 3)"
      let s_1 := (s + (Int.tmod i (3 : Int)))
      Faithful.ck (Faithful.inRange (i + (1 : Int))) "range check failed at line 3: i++"
      let i_1 := (i + (1 : Int))
      Model.sumTo_loop1_chk n s_1 i_1
    else
      pure (s, i)
termination_by ((n - i)).toNat
decreasing_by
  faithful_decreasing

def sumTo_rangeOk (n : Int) : Bool := Faithful.rangeOkOf (Model.sumTo_chk n)

def sumTo_pre (n : Int) : Bool :=
  ((Faithful.intOk n)) && (Model.sumTo_rangeOk n)
```

`instrumentedTs`:

```ts
function sumTo(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i = __faithful.add(i, 1, "line 3: i++")) {
        s = __faithful.add(s, (__faithful.mod(i, 3, "line 3: i % 3")), "line 3: s + (i % 3)");
    }
    return s;
}
```

Notes on this translation (the `notes` field): `integer semantics: number is modeled as Int; intermediates must stay
within ±2^53 (range-ok)`, `termination (loop sumTo_loop1): counting up: i < n with i increased by 1 in the
incrementor`, `JS % is truncated (sign of the dividend): modeled as Int.tmod, never Lean %`. Other notes the translator
attaches when they apply: `UTF-16 gap`, `string < compares UTF-16 code units`, `toLowerCase/toUpperCase are modeled on
ASCII letters only`, `Math.floor(a / b) is modeled as Int.fdiv a b`, `throw is modeled as Except String`,
`sort: stable merge sort (List.mergeSort) ...`, and the termination pattern of every loop and of the recursion.

Other parts of a `Translation`: `plainTs` (the module constants the function reads, verbatim, then the function: what
the differential tester runs as "the original"), `throwSites`, `canThrow`, `lean.records` (emitted structures),
`lean.paramNames` (sanitized binder names: `max` becomes `max_`; Lean keywords and every identifier-shaped Lean token,
including Mathlib's such as `to`, get a `_` suffix), `source.hash`, `lean.hash`. `buildInstrumentedRunner(t)` returns JavaScript source for `(args) => Outcome`: `ok`, `throw` (the literal
message), `range-violation` (any failed check, including ascii, depth and length) or `fault` (anything else, never
agreement).

## 12. Corpus coverage

Produced by `node --experimental-strip-types packages/engine/scripts/corpus-report.ts --differential` after
`pnpm exec tsc -b`, run for this document. Stamp line as the script printed it:

> Measured 2026-10-05 (2026-10-05T07:51:52.456Z). Toolchain: Node v25.8.1, darwin-arm64, Lean (version 4.34.0,
> arm64-apple-darwin24.6.0, commit 293d5d0c0c3f3dded4688b3ccd6a33939ac5102b, Release) (toolchain
> leanprover/lean4:v4.34.0), Mathlib 5ed2965256430c3649e86755f9576b54eca72435, model id gpt-6-luna (not used: the
> translator makes no model call).

The corpus is `packages/translate/corpus`: 74 files, each with a `// @corpus` header whose label (`expect=ok` or
`expect=refuse` with a code) was written independently of the translator. The coverage-only run (without
`--differential`, a few seconds earlier the same day) printed identical coverage tables.

### Coverage

| class | files | in subset | labeled ok, refused (translator gap) | labeled refuse, refused with the labeled code | label/translator mismatch |
|---|---|---|---|---|---|
| numeric | 14 | 10 | 1 | 3 | 0 |
| array | 16 | 13 | 1 | 2 | 0 |
| string | 12 | 10 | 1 | 1 | 0 |
| recursive | 10 | 5 | 2 | 3 | 0 |
| refuse | 22 | 1 | 0 | 21 | 0 |
| **all** | **74** | **39** | **5** | **30** | **0** |

In subset: 39 of 74 corpus functions. Of the 44 labeled `expect=ok`, 39 are accepted and 5 are refused by the
translator. (The one accepted function in the `refuse` class, `refuse/prefixSumUntilNegative`, uses `break`. It was first labeled
`expect=refuse code=unsupported-syntax` and was relabeled `expect=ok` once NOTES.md documented the `break`/`continue`
encoding (section 4.2), which the subset text allows; its header records the relabeling.)

Refusals by code:

| code | count | files |
|---|---|---|
| no-termination-measure | 10 | numeric/gcd, numeric/isPrime, array/binarySearch, string/isPalindrome, recursive/ackermann, recursive/collatzSteps, recursive/countDigits, recursive/digitSum, recursive/gcd, refuse/collatzSteps |
| float | 5 | numeric/sumRange, array/medianMean, refuse/average, refuse/isPerfectSquare, refuse/polynomialValue |
| unsupported-syntax | 3 | numeric/lcm, refuse/clamp, refuse/lcmOfList |
| map-set | 2 | refuse/firstDuplicate, refuse/mostFrequent |
| mutable-capture | 2 | array/runningMax, refuse/nextId |
| regex | 2 | string/isSlug, refuse/isValidHexColor |
| async | 1 | refuse/totalPages |
| bitwise | 1 | refuse/midpoint |
| date | 1 | refuse/isLeapYear |
| dictionary | 1 | refuse/wordCounts |
| generic | 1 | refuse/chunk |
| io | 1 | refuse/runningTotals |
| missing-annotation | 1 | refuse/remainderSum |
| nan | 1 | refuse/digitValue |
| random | 1 | refuse/pickRandom |
| this | 1 | refuse/perimeter |
| unsupported-library | 1 | refuse/codePointsToString |

Translator gaps (labeled `ok` under the subset v1 text, refused by the translator; the list is
`KNOWN_TRANSLATOR_GAPS` in `packages/engine/src/differential/corpus.ts`):

- numeric/gcd: `no-termination-measure`. Measure |b| (|a tmod b| < |b|); the finder only knows `p - k`,
  `Math.floor(p / k)` and `slice`.
- recursive/gcd: `no-termination-measure`. Same function.
- array/binarySearch: `no-termination-measure`. Measure `hi - lo` with `lo`/`hi` updated in different branches
  (interval measure).
- string/isPalindrome: `no-termination-measure`. Measure `j - i` with `i++` and `j--` (two loop variables).
- recursive/digitSum: `no-termination-measure`. Measure `Math.abs(n)` through `const m = Math.abs(n)`; the finder only
  measures parameters themselves.

Label/translator mismatches: none.

### Differential: TypeScript original vs Lean model

`tsVsLean`, 300 generated inputs per accepted function, seed 20261004, real Lean `#eval`, same run and stamp as above.
"Inputs" are inputs that satisfy the `int-bound` and `bmp` preconditions. For each input the instrumented original runs
first: if it reports a range violation, Lean's `rangeOk` / `asciiOk` / `pre` must be false there ("range-excluded",
with the number where Lean agreed in parentheses); otherwise the plain original's outcome (`ok` value or `throw`
message) is compared with the Lean model's.

| function | inputs | model compared (ok / throw) | agreements | range-excluded (rangeOk agreed) | TS faults | too costly for Lean | disagreements |
|---|---|---|---|---|---|---|---|
| numeric/aliquotSum | 300 | 251 (251 / 0) | 251 | 0 (0) | 35 | 14 | 0 |
| numeric/clamp | 300 | 300 (170 / 130) | 300 | 0 (0) | 0 | 0 | 0 |
| numeric/collatzSteps | 300 | 293 (50 / 243) | 293 | 7 (7) | 0 | 0 | 0 |
| numeric/digitSum | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| numeric/factorial | 300 | 172 (19 / 153) | 172 | 128 (128) | 0 | 0 | 0 |
| numeric/fibRecursive | 300 | 177 (177 / 0) | 177 | 105 (105) | 18 | 0 | 0 |
| numeric/fibonacci | 300 | 183 (30 / 153) | 183 | 117 (117) | 0 | 0 | 0 |
| numeric/floorDivMod | 300 | 293 (287 / 6) | 293 | 7 (7) | 0 | 0 | 0 |
| numeric/intPow | 300 | 200 (53 / 147) | 200 | 100 (100) | 0 | 0 | 0 |
| numeric/sign | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| array/countOccurrences | 300 | 188 (188 / 0) | 188 | 112 (112) | 0 | 0 | 0 |
| array/dedupe | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| array/flattenPairs | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| array/maxSubarraySum | 300 | 283 (282 / 1) | 283 | 17 (17) | 0 | 0 | 0 |
| array/maxWindowSum | 300 | 298 (144 / 154) | 298 | 2 (2) | 0 | 0 | 0 |
| array/medianFloor | 300 | 297 (296 / 1) | 297 | 3 (3) | 0 | 0 | 0 |
| array/prefixSums | 300 | 282 (282 / 0) | 282 | 18 (18) | 0 | 0 | 0 |
| array/reverseArray | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| array/sortPointsByY | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| array/spread | 300 | 282 (282 / 0) | 282 | 18 (18) | 0 | 0 | 0 |
| array/sum | 300 | 282 (282 / 0) | 282 | 18 (18) | 0 | 0 | 0 |
| array/sumOddSquares | 300 | 269 (269 / 0) | 269 | 31 (31) | 0 | 0 | 0 |
| array/twoSum | 300 | 274 (274 / 0) | 274 | 26 (26) | 0 | 0 | 0 |
| string/caesarShift | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| string/capitalize | 300 | 254 (254 / 0) | 254 | 46 (46) | 0 | 0 | 0 |
| string/countChar | 300 | 300 (76 / 224) | 300 | 0 (0) | 0 | 0 | 0 |
| string/countVowels | 300 | 254 (254 / 0) | 254 | 46 (46) | 0 | 0 | 0 |
| string/ellipsize | 300 | 293 (293 / 0) | 293 | 7 (7) | 0 | 0 | 0 |
| string/longestRun | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| string/repeatString | 300 | 244 (102 / 142) | 244 | 0 (0) | 17 | 39 | 0 |
| string/reverseString | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| string/toCsvRow | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| string/trimControl | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| recursive/fibonacci | 300 | 177 (24 / 153) | 177 | 105 (105) | 18 | 0 | 0 |
| recursive/flattenPairs | 300 | 300 (300 / 0) | 300 | 0 (0) | 0 | 0 | 0 |
| recursive/powerBySquaring | 300 | 216 (69 / 147) | 216 | 84 (84) | 0 | 0 | 0 |
| recursive/reverseDigits | 300 | 261 (126 / 135) | 261 | 39 (39) | 0 | 0 | 0 |
| recursive/toBinary | 300 | 300 (147 / 153) | 300 | 0 (0) | 0 | 0 | 0 |
| refuse/prefixSumUntilNegative | 300 | 297 (297 / 0) | 297 | 3 (3) | 0 | 0 | 0 |
| **39 functions** | **11700** | **10520** | **10520** | **1039 (1039)** | **88** | **53** | **0** |

Read this table for what it is: on 11,700 generated inputs to 39 functions, 10,520 outcomes were compared and all
agreed; 1,039 inputs fell outside `rangeOk` on the TypeScript side and Lean's `rangeOk` was false on every one of them;
88 inputs made the TypeScript original fault (timeout or stack overflow) and 53 were too costly to evaluate in Lean.
Those 141 inputs were compared with nothing; they are not agreements. TS faults are never sent to Lean, and too-costly
means the TS call took more than 20 ms or returned more than 100,000 characters. This is testing on sampled inputs, not
a proof about all inputs.

## 13. Red-team summary

The red team writes adversarial TypeScript functions ("probes") aimed at one claim of the translator each, in four areas
(arithmetic, arrays, control, strings), in rounds. Probes live in `packages/translate/corpus-redteam/<area>/`, one
exported function per file, and are run by `packages/engine/src/redteam-<area>.test.ts` against the real translator,
the real sandbox and real Lean.

Terms:

* **probe**: one file. Its header says what the translator must do (accept, or refuse with a given code) and gives
  hand-picked edge inputs.
* **held**: the translator already did the right thing when the probe was written: refused with the expected code, or
  accepted with a model that compiles (tier `proved` for every definition) and shows zero disagreements in `tsVsLean`
  on the listed inputs plus generated ones (25 per probe in control, 60 in arithmetic, 150 in arrays and strings).
* **divergence found**: the probe showed a concrete difference when it was written (a wrong value with `pre` true, a
  missing range check, a model that does not compile, a translator crash, a harness false alarm, or a refusal of a
  function that should be accepted). Its header says `status=divergence` and keeps saying so after a fix. The probe's
  test is written as the correct behavior, so it fails until the fix lands (never `it.fails`).
* **fixed**: a divergence probe whose test passes now. **open**: one whose test fails now.

### Round 1 (figures supplied with this task, as recorded for the round-1 run)

| area (matched by probe count) | probes | held | divergences found |
|---|---|---|---|
| arithmetic | 82 | 75 | 7 |
| strings | 82 | 73 | 5 |
| arrays | 72 | 69 | 3 |
| control | 197 | 190 | 7 |
| **round 1** | **433** | **407** | **22** |

The figures were supplied as four unlabeled rows; the area for each row is our matching by probe count against the
files on disk (below). For strings the row does not add up: 82 probes, 73 held, 5 found leaves 4 probes unaccounted
for. On disk, 9 round-1 strings probes carry `status=divergence` (82 - 73 = 9). Several of them look like more than one
probe exhibiting one defect (`litUnionCode` / `litUnionIndex` / `litUnionLower`: literal-union receivers not
instrumented; `moduleConstHarness` / `moduleConstSpecial`: plain original run without its module constants;
`refuseModuleAstral` / `refuseModuleLone`: translator crash on a non-BMP module constant; `whileNonEmptyStr` /
`recStrNonEmpty`: `s !== ""` shrink guard not recognized), which would explain 5 distinct divergences, but we have
not confirmed how the figure 5 was counted.

### All rounds, counted from the probe files (2026-10-05)

Counted from the headers on disk on 2026-10-05 (`round=N` header token, else the `r2`/`r3`/`r4` file-name prefix, else
round 1). "Divergence files" counts probes whose header says `status=divergence`.

| round | arithmetic | arrays | control | strings | probes | divergence files |
|---|---|---|---|---|---|---|
| 1 | 82 (7) | 72 (3) | 197 (7) | 82 (9) | 433 | 26 |
| 2 | 39 (3) | 52 (3) | 65 (3) | 62 (1) | 218 | 10 |
| 3 | 56 (6) | 78 (3) | 52 (8) | 60 (0) | 246 | 17 |
| 4 | 39 (5) | 61 (7) | 79 (3) | 55 (0) | 234 | 15 |
| **all** | **216 (21)** | **263 (16)** | **393 (21)** | **259 (10)** | **1131** | **68** |

(Cells: probes (divergence files).)

### Status now (fixed vs open)

Run for this document on 2026-10-05 (Node v25.8.1, Lean 4.34.0, Mathlib `5ed29652...`), with Lean, after the final fix
pass (below):

```
pnpm exec vitest run packages/translate packages/engine
Test Files  17 passed (17)
     Tests  2321 passed (2321)
```

That run includes the four red-team files (arithmetic 360, arrays 420, control 671, strings 434 tests: 1885, all
passing). Before the fix pass the same four files had 22 failing tests out of 1892: exactly the 15 round-4 divergence
probes (each arrays probe has two tests). The arrays file has 7 tests fewer now because its `tsVsLean` test exists only
for probes the translator accepts, and the 7 arrays divergence probes are now refused as their headers require. Every
divergence probe of every round (68 files) now passes.

Round 4 found 15 divergences in three families; all were fixed in a final fix pass (details in
`packages/translate/NOTES.md`, "Red-team round 4 decisions"):

| family | probes | what went wrong | kind | fix |
|---|---|---|---|---|
| TypeScript error suppression (arrays) | `r4TsIgnoreSortStrMinus`, `r4TsExpectErrorSortStrMinus`, `r4TsNocheckSortStrMinus` | `a - b` on string keys nested in a conditional comparator was accepted under `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`; JavaScript computes `NaN` (pair treated as equal), the model sorted | soundness | the directives are refused (section 2, phase 5); the comparator reader also refuses a nested string subtraction itself |
| | `r4TsIgnoreConstAssign`, `r4TsIgnoreForOfConstAssign`, `r4TsIgnoreForConstIndex` | assignment to a `const` accepted under `@ts-ignore`; JavaScript throws `TypeError`, the model returned a value with `pre` true | soundness | directive refused; the lowering also refuses assignment to a `const` itself |
| | `r4TsIgnoreDupKey` | duplicate object-literal key accepted; the model did not compile | Lean error | directive refused |
| Lean tokens as names (arithmetic) | `r4TokParam`, `r4TokLocal`, `r4TokField`, `r4TokFnName` | a name such as `using`, `until`, `matches`, `repeat` was not sanitized; the model did not parse | Lean error (completeness) | the reserved-name list is now the Lean parser's whole token table, re-checked against real Lean by a test |
| | `r4TokTacticsTo` | `to` parsed under `Faithful.Core` but not with `Faithful.Tactics` (theorem files) | Lean error (completeness) | same (the table is dumped under both imports) |
| Sloppy-mode module constants (control) | `r4ModuleOctalConstRead`, `r4ModuleLeadingZeroConstRead`, `r4ModuleOctalEscapeConstRead` | a module constant that is invalid in strict mode (`010`, `09`, octal escape) was inlined, while the ES module cannot load | unloadable original accepted | a TypeScript error (or directive) in the statement of a module constant the function reads is refused |

No test expectation and no golden file changed in the fix pass (the corpus goldens did not drift: no corpus function
uses a newly reserved name).

**Why red-teaming stopped after round 4.** Stopping was a decision, not a sign that the red team ran out of findings.
Each round kept finding new cases (26, 10, 17 and 15 divergence files in rounds 1 to 4), and the later ones were
increasingly exotic: comment directives that hide diagnostics, Mathlib-only tokens as parameter names, legacy octal
literals in module constants. There is no evidence that a fifth round would find nothing. The translator's claims rest
on the probes listed here and on the other tests, not on an exhausted search.

What the earlier rounds found and fixed, by family (details in `packages/translate/NOTES.md`): round 1: literal-union
types not instrumented on the TypeScript side; non-integer literal types silently narrowed; module constants missing
from the plain original (harness false alarms); translator crashes on non-BMP module constants; `sort` on an aliased
array (via `reduce` or recursion) mutating a parameter; `__faithful` as a user name; unbounded recursion depth
(`stackDepth`); `s !== ""` shrink guards not recognized. Round 2: module code patching or shadowing `Math`
(`mathFloorPatched`, `mathAbsPatched`, `moduleMathShadow`); `__proto__` and empty field names; let-bound recursion
guards whose models did not compile; string length beyond V8's limit (`r2StrLengthLimit`). Round 3: precondition and
runner code captured by parameters or functions named `Math`, `Number`, `run`, `value`, `input`,
`FaithfulRangeViolation`; `this` pseudo-parameters on callbacks shifting the parameter binding; `"" !== s` with the
literal on the left not closing the termination proof.

Never claim more than this: the red team covers the probes listed, and each held probe was checked on its listed inputs
plus a fixed number of generated ones.

## 14. Gaps (plain words)

Every gap we know of, in plain words. "Excluded by a precondition" means the model says nothing about such inputs, and
the tool must not present a result as covering them. "Refused" means the function is not translated at all.

### Where the model differs from JavaScript (covered by a precondition)

* **UTF-16 gap.** JavaScript strings are sequences of UTF-16 code units; the model's strings are lists of Lean `Char`s.
  The two match one-to-one only for Basic Multilingual Plane text. An emoji or any other character outside the BMP is
  two code units in JavaScript (so `"😀".length === 2`) but would be one `Char` in Lean, and a lone surrogate cannot be
  a Lean `Char` at all. So every string argument must be BMP text without lone surrogates (`bmp` precondition), and a
  string literal or module string constant containing such characters is refused (`non-bmp`). Results about functions
  that take strings say nothing about emoji input.
* **Case mapping is ASCII-only.** `toLowerCase` / `toUpperCase` in the model change only the letters A-Z and a-z. Real
  JavaScript applies full Unicode case mapping, including mappings that change the length of the string (`"ß"` upper-cases
  to `"SS"`, `"İ"` lower-cases to two units). So every string that reaches a case mapping, whether a parameter, a
  literal or a computed string, must be ASCII (`ascii` precondition). Results about such functions say nothing about
  non-ASCII text.
* **Number range.** `number` is modeled as an unbounded integer. Every intermediate value must be an integer within
  ±2^53 (`range-ok`). Outside that range JavaScript doubles round, and the model would be exact, so such inputs are
  excluded.
* **Out-of-range reads.** `xs[i]`, `s[i]` and `s.charCodeAt(i)` out of range give `undefined` / `NaN` in JavaScript.
  The model returns an arbitrary default value there instead; `range-ok` excludes those inputs. A specification must
  not depend on what the model returns there.
* **Recursion depth.** The model has no stack; JavaScript does. A recursive function is inside the model only while at
  most 500 calls are active at once (`range-ok`). The frame size of a function is not bounded by the subset, so a
  function with very large frames run on a small stack could still overflow at a depth of 500 or less; the TypeScript
  side then reports `fault`, which is never counted as agreement, but the Lean `pre` would still be true there.
* **String length.** V8 rejects strings longer than 2^29 - 24 units. The model limits every string built by
  concatenation or `join` to 2^24 units (`range-ok`).
* **Arrays have no length bound.** There is no array counterpart of the string bound. An input that makes a function
  build an enormous array (for example 30 doublings with `xs.concat(xs)`) exhausts memory in JavaScript; the harness
  reports a `fault` (never agreement), but a theorem `pre args -> ...` about the model still covers such an input, as
  it does any input whose evaluation exhausts memory or time.

### Sort

* **Stability.** The model sorts with `List.mergeSort`, which is stable; JavaScript's sort has been stable since
  ES2019. With a consistent comparator the stable result is unique, so they agree. This relies on the engine being
  ES2019 or later (Node v25.8.1 here).
* **Only readable comparators.** Only comparators the translator can read as "ascending or descending by one key" are
  accepted: `a.k - b.k`, `b.k - a.k`, or nested conditionals over `<`, `<=`, `>`, `>=`, `===`, `!==` with literal
  results that return 0 for equal keys. Two-key comparators, comparators whose key is computed rather than read
  (`a.toLowerCase()`, a string's `a.length - b.length`, indexing by a variable), comparators with a `this` parameter, and
  inconsistent comparators are refused. Plain `.sort()` is accepted only on string arrays.
* **Sort only a fresh array.** `xs.sort(...)` on a parameter or variable is refused because it mutates; write
  `xs.slice().sort(...)`.
* **Comparators are not range-checked.** The sign of `a - b` is exact for integers within ±2^53 even when the
  difference itself is not, so this is sound for numeric keys under `int-bound`; it is a deliberate omission, not an
  oversight.

### Refused although the function is fine (completeness gaps)

* **No calls to other functions.** A function that calls any other function of its file, even a pure helper, is refused
  ("calls to other functions are outside subset v1"). `numeric/lcm` (calls `gcd`) is the corpus example. Mutual
  recursion is therefore impossible too.
* **Termination measures the translator cannot find.** `gcd`-style recursion `f(b, a % b)`; binary search (`lo <= hi`
  with `lo`/`hi` moved in branches); two indices moving toward each other (`isPalindrome`); a measure on a derived value
  (`const m = Math.abs(n)`); `n === 0` as the only base case; `Math.ceil(n / 2)` halving; `Math.floor(n / -2)`;
  `for (;;)` / `while (true)` with `break`; `while (x !== 0)`; recursion inside a loop or callback; lexicographic
  measures (Ackermann). Five corpus functions labeled `ok` are refused for this reason (section 12).
* **`break` and `continue` are supported, labels are not.** Labeled `break`/`continue`, `do...while`, `switch`,
  `for...in`, `try`/`catch` are refused.
* **Option-typed locals.** `T | null` is allowed only as the function's whole return type. A local such as
  `let best: number | null = null` is refused.
* **Strings.** `for...of` over a string is refused (it iterates code points; index the string instead). `includes`,
  `startsWith`, `endsWith`, `trim`, `replace`, `substring`, `repeat`, `padStart`, `lastIndexOf`, `localeCompare`,
  `at`, `codePointAt`, `normalize` on strings are refused (not in the v1 library list). `split` with a limit or a regex
  is refused.
* **Equality.** `===` / `==` only between two values of the same primitive type. Comparing arrays, tuples or records
  (reference equality in JavaScript), comparing with `null`/`undefined`, and mixed-type `==` are refused.
* **Truthiness.** Conditions, `!`, `&&`, `||` must be booleans. `if (n)`, `if (s)`, `xs.length && ...` are refused.
* **Closures.** A callback that reads a variable which is reassigned anywhere in the function (even before the callback
  is created, or a loop counter) is refused. This is stricter than necessary.
* **Module scan over-refuses.** Any value import, side-effect import, re-export or class at module level makes every
  function of the file refused, even when harmless.
* **Control-flow size.** Code after an `if` with an early `return`/`break`/`continue` is duplicated into each branch;
  very branchy functions hit the 40,000-node bound and are refused.
* **Floats.** Any division not written as `Math.floor(a / b)` or `Math.ceil(a / b)` is refused, including divisions
  that are always exact (Gauss's formula `(hi - lo + 1) * (lo + hi) / 2`, corpus `numeric/sumRange`). `Math.round` is refused rather than
  treated as the identity.

### Known residual risks in what is accepted

* **Temporal dead zone at module load.** A module constant initialized from a later one (`const a = b; const b = 1;`)
  throws a `ReferenceError` when the module loads. The module scan allows identifier initializers, so such a file is not
  refused; the module cannot be imported at all, so no claim about the function is observable.
* **Unloadable module, constant not read.** A module constant the function does not read can still make the ES module
  unloadable (`const K = 010` elsewhere in the file: a SyntaxError in strict mode). Such a file is accepted
  (`r4ModuleOctalConst`, held): the module cannot be imported at all, so no claim about the function is observable. A
  constant the function does read is checked (section 4.4).
* **Comment directives are refused by text, not by TypeScript's rule.** Any comment containing `@ts-ignore`,
  `@ts-expect-error` (in the function or a module constant it reads) or `@ts-nocheck` (anywhere in the file) refuses the
  function, even a comment that only mentions the word. Over-refusal, never a hidden diagnostic (fixed in round 4; before,
  these comments let string subtraction in comparators, assignment to `const` and duplicate keys through).
* **Declared types are trusted where TypeScript allows lies.** `declare global` interface merges on `String` and similar
  were probed in red-team round 4 (`r4DeclGlobal*`) and held; this is a probe result, not a proof that every type lie is
  caught.
* **`-0` is assumed unobservable.** Held by red-team probes (`r4NegZeroInvisible`, `r4NegZeroDivisor`); not proved.
* **Everything in this document about agreement is tested, not proved.** The Lean side proves termination of the model
  and checks its own axioms; the correspondence between the model and JavaScript rests on the encoding arguments above,
  the unit tests, the differential runs and the red-team probes.
