# packages/translate: decisions and semantic gaps (running list)

Raw notes for docs/TRANSLATOR.md. Date: 2026-10-04 (red-team round 2 to 4 entries: 2026-10-05). Toolchain: Node v25.8.1, TypeScript 5.9.3, Lean 4.34.0,
Mathlib `5ed2965256430c3649e86755f9576b54eca72435`.

## Pipeline and module map

| Module | Role |
|---|---|
| `program.ts` | In-memory `ts.Program` (ES2023 lib only, no DOM, no `@types`, `strict`, *not* `noUncheckedIndexedAccess` so `a[i]: T`). Lib `SourceFile`s cached per process; the previous program is passed as `oldProgram`. |
| `module.ts` | Module scan: refuses top-level statements that run code when the module loads (red-team round 2). |
| `scan.ts` | Feature scan: one pre-order source-order walk refusing the "feature" codes. `isGlobal` (builtin-name test). |
| `types.ts` | Refusal plumbing, exact spans, checker type -> subset `Ty`, record registry, Lean name hygiene. |
| `lower.ts` | TS -> IR (continuation-passing statement lowering, loops -> recursive functions, measure finder). |
| `ir.ts` | The IR, `PRIM_DOC` (JS meaning of every primitive), `CHECKED_OPS` (the one table of range checks). |
| `emit.ts` | IR -> Lean: model, checked twin, `rangeOk`/`asciiOk`/`pre`, record structures, JSON encoders, precondition predicates. |
| `instrument.ts` | `instrumentedTs` and `buildInstrumentedRunner`. |
| `codec.ts` | `valueToLean`, `leanEvalExpr`, `leanPredicateExpr`, `leanChkEvalExpr`, `parseLeanOutcome`. |
| `translate.ts` | API: `translate`, `translateWithIr` (for the SMT encoder), `listExportedFunctions`, `refusalStats`. |

Measured (this machine, warm): `translate()` ~100 ms for the first call in a process (lib parse + bind), 3-4 ms after.
Results are memoized per (fnName, source) (64 entries).

## Refusal order ("first, most fundamental refusal wins")

1. locate: `not-found` (absent: span 0..0; present but not exported: the name). Overloads -> `unsupported-syntax`.
   A function bound with `let`/`var` -> `mutable-capture`.
1b. module scan (`module.ts`): the first top-level statement, in source order, that runs code when the module loads ->
   `unsupported-syntax`, span = the statement (see "Module scan" below).
2. signature: `async` / generator -> `async`; type parameters -> `generic`; then parameters left to right
   (`this` param -> `this`; destructuring/rest/default/optional -> `unsupported-syntax`; no annotation ->
   `missing-annotation`; type -> `unsupported-type` / `dictionary` / `map-set` / `date` / `regex` / `async`);
   then the return annotation (missing -> `missing-annotation`, span = function name).
3. feature scan of the body, first offending node in source order (pre-order: outer before inner):
   regex, date, map-set, nan, io, random, async, generic (explicit type arguments), bitwise, this, float, non-bmp,
   dictionary, and `missing-annotation` for an unannotated `[]` initializer. A global call like `new Map<K, V>()`
   reports the global's code (`map-set`), not `generic`.
4. comment directives (red-team round 4): a comment anywhere in the file containing `@ts-nocheck`, then a comment containing `@ts-ignore` /
   `@ts-expect-error` that lies in `[statement.pos, statement.end)` (leading comments included) or whose next line
   (TypeScript's rule) is a line of the statement (`findLineDirectiveFor`) ->
   `unsupported-syntax`, span = the comment. Then TypeScript errors whose start lies inside the function statement ->
   `unsupported-syntax` ("does not type-check: TS<code> ..."), span = the diagnostic's span. Rationale: without a
   type-correct function the checker types the translator relies on are not trustworthy.
5. lowering (source order; a loop's measure is checked at its header before its body is lowered):
   unsupported-syntax, unsupported-library, unsupported-type, missing-annotation, mutable-capture,
   no-termination-measure; for a module constant the function reads (at its first read): `non-bmp`, and
   `unsupported-syntax` for a TypeScript error or a `@ts-ignore` / `@ts-expect-error` comment in its statement
   (round 4).

Spans are UTF-16 offsets from the node's first token (`getStart`, leading trivia excluded) to its end; `line` and
`column` are 1-based.

## Types

* `number` -> `Int`; `boolean` -> `Bool`; `string` -> `List Char` (BMP; one `Char` = one UTF-16 unit); `T[]` -> `List T`;
  tuples (>= 2 elements, no optional/rest) -> right-nested `×`; plain object types -> a Lean `structure` per shape
  (named after the interface/alias when there is one, capitalized; `Rec<n>` otherwise; never the function's own name);
  `T | null` / `T | undefined` -> `Option T`, **only as the whole return type**.
* Refused: any/unknown, unions of different types, `number | null` anywhere but the return type (including local
  variables of option type: `let best: number | null = null` is refused, a finding), intersections, enums, bigint,
  symbols, functions as values, optional fields, methods/accessors, recursive record types, 0/1-tuples, empty objects.
* Union of literal types of one kind (`1 | 2`, `"a" | "b"`) maps to int/string. A number literal type (alone or in a
  union) must be an integer within ±2^53: `1 | 2.5` or `0.5` -> `float`, `1e300` -> `unsupported-type` (red-team round 1,
  floatLiteralType: before, the int-bound precondition silently dropped the non-integer part of the declared domain).
* A record field named `__proto__` -> `unsupported-type` (red-team round 2, r2ProtoFieldLiteral / r2ProtoFieldStringKey):
  in an object literal, `__proto__: v` and `"__proto__": v` set the prototype instead of creating a field (a primitive
  `v` is dropped), while the model and `JSON.parse` treat it as a field; pre was true and the values differed. Refused at
  the type, so literals, projections and the harness's generated inputs never meet it. (Shorthand `{ __proto__ }` and
  computed keys would create a field, but the type is refused anyway.)
* The empty field name `""` gets the Lean name `v` (collisions suffixed as usual: a real field `v` becomes `v_`); the
  JSON key stays `""` (red-team round 2, r2EmptyFieldName: `leanIdent("")` was `""`, so the model did not parse).
* Records with identical shapes share one structure (TS is structural). Field names that clash with Lean-generated
  names (`mk`, `rec`, `casesOn`, ...) get a `_` suffix; JSON keys keep the TS name.

## Semantics decisions (each is a deliberate, sound choice)

* **Integers.** Exactly DESIGN.md: `+ - *` on `Int`; `%` -> `Int.tmod`; `Math.floor(a / b)` -> `Int.fdiv`;
  `Math.ceil(a / b)` -> `Faithful.cdiv` = `-(Int.fdiv (-a) b)`; bare `/` -> `float`. `Math.floor(x)`/`Math.ceil(x)` of an
  integer expression is the identity. `Math.abs` -> `Faithful.iabs` (natAbs-based), `Math.min/max` n-ary -> nested
  `Min.min`/`Max.max` (0 arguments -> `unsupported-library`, it is ±Infinity). `Math.round` -> `float` (refused rather
  than treated as the identity; it signals non-integer intent). `Math.trunc/sign/...` -> `unsupported-library`.
  Integer literals beyond ±2^53, or not exactly representable, -> `unsupported-syntax`.
* **Why `Math.floor(fl(a / b)) = fdiv(a, b)` for |a|, |b| <= 2^53 (b != 0).** The rounded quotient is
  `(a/b)(1+d)`, |d| <= 2^-53. Rounding can cross an integer boundary only if the distance from a/b to the next
  integer, which is >= 1/|b|, is at most |a/b|·2^-53, i.e. |a| >= 2^53; at |a| = 2^53 the tie cases require b to be a
  power of two, where the division is exact. Checked by a fast-check property (20,000 edge-weighted samples including
  ±2^53 neighbourhoods) against BigInt floor/ceil division, together with `%` = BigInt truncated remainder
  (`translate.test.ts`).
* **The bound is inclusive ±2^53** (`MAX_SAFE`). The TS helpers are exact: `|r| < 2^53` is trusted (if the true value
  had |v| >= 2^53 the rounded result would too); at `|r| = 2^53` exactness is checked with BigInt (e.g. 2^53 + 1 rounds
  to 2^53 and is a violation). `Number.isSafeInteger` is never used (it is < 2^53). Property-tested against BigInt.
* **Equality.** `===`/`!==` (and `==`/`!=`) only between two values of the same primitive type. On arrays, tuples and
  records JS compares references: refused. Comparison with `null`/`undefined`: refused.
* **Truthiness.** Conditions, `!`, `&&`, `||` require booleans (JS `&&`/`||` return an operand). Refused otherwise.
  `??`, `?.`, comma, `in`, `instanceof`, `typeof`, `delete`, `void`, `**`, `as`, tagged templates: refused.
  `x!` and `satisfies` are accepted as the identity (no runtime effect).
* **Strings.** `+` with a number/boolean operand converts with `Faithful.intToStr` (exact for |n| <= 2^53: no
  exponent form below 1e21) / `boolToStr`; arrays/records in string context refused. `s < t` is lexicographic by
  code unit (`Faithful.strLt`; code units = code points for BMP text). `charAt` out of range is `""`;
  `s[i]` and `charCodeAt(i)` out of range are excluded by `rangeOk` (the model reads `Faithful.getD` /
  returns 0). `indexOf(sub, pos)`: pos clamped to [0, length], empty `sub` found at the clamped position.
  `split(sep)` (1 argument; no limit, no regex): empty separator -> one string per unit (`"".split("")` = `[]`);
  `"".split(",")` = `[""]`; left-to-right non-overlapping. `join(sep?)` on string[], number[] (via intToStr),
  boolean[]. Template literals = concatenation. `includes/startsWith/trim/replace/...` on strings are not in the
  v1 library list: `unsupported-library`.
* **ASCII case mapping.** `toLowerCase/toUpperCase` map ASCII letters only in Lean. The `ascii` precondition
  (`Model.<fn>_asciiOk`) is read off the checked twin, which checks *every string that reaches* a case mapping
  (not just the parameters, so literals and derived strings are covered). It has no `ts` expression: the
  instrumented original reports a non-ASCII string reaching a case mapping as `range-violation` (detail
  `ascii check failed ...`).
* **Arrays.** Immutable: `push/pop/splice/reverse/fill/...` and element/field assignment refused. `concat` only with
  arguments of exactly the receiver's array type (JS spreads array arguments; an argument typed as the element type
  would be appended, or spread if the element type is itself an array, so it is refused). `indexOf/includes` only on
  primitive element types and without a start index. `reduce` requires an initial value. Callbacks take
  `(x)`/`(x, i)` (map, filter) or `(acc, x)`/`(acc, x, i)` (reduce); the third "array" parameter is refused.
  `filter` callbacks must return a boolean.
* **sort.** The receiver must be a fresh array, one no other live reference can see: `xs.sort()` on a variable mutates
  it, which would make the function impure; refused with a hint. Fresh (`isFresh`): array literals; results of
  `slice/concat/map/filter/split` (each allocates); `sort` of a fresh receiver (it returns its receiver); a
  conditional with fresh branches; a self-call when *every* `return` of the function returns a fresh value (self-calls
  inside those returns are assumed fresh: induction over the terminating recursion). Not fresh: variables, `reduce`
  (returns its accumulator, i.e. possibly the initial value or an element of the receiver), any other call. Red-team
  round 1 (sortReduceAlias, sortRecursionAlias, sortReduceInnerAlias): "any call result is fresh" let `sort` mutate a
  parameter the model treats as immutable, with pre = true; these are now `unsupported-syntax`. The comparator is read
  symbolically: its sign is evaluated for the three orders of key(a) vs key(b); it must give 0 for equal keys and
  opposite non-zero signs otherwise. Accepted forms: `K(a) - K(b)`, `K(b) - K(a)` (numeric keys), and nested
  conditionals over `<, <=, >, >=, ===, !==` of `K(a)` and `K(b)` with literal results (numeric or string keys), where
  `K(x)` is `x`, `x.f`, `x[literal]` or a chain. Plain `.sort()` only on string[] (on numbers it compares decimal
  strings). Lean: `List.mergeSort xs (fun a b => key a <= key b)` (stable; JS sort is stable since ES2019, and a
  consistent comparator determines a unique stable result). Comparators are not instrumented: V8 and mergeSort compare
  different pairs, and the sign of `a - b` is exact for integers within ±2^53 even when the difference is not.
* **throw.** Only `throw new Error("literal")`, `throw Error("literal")`, `throw "literal"`. Modeled as
  `Except String`. Not inside callbacks. Other `Error` classes refused.
* **Option returns.** `return null`/`return undefined`/`return;`/falling off the end -> `none`; a `T`-typed value ->
  `some v`; a ternary with a nullish branch is split; a recursive call is passed through.
* **Closures.** Callbacks may read parameters and variables that are never reassigned; reading a reassigned `let`
  (including a loop counter) is refused as `mutable-capture` (strict reading of "no closures over mutable state";
  sound but conservative). Assigning an outer variable inside a callback: `mutable-capture`. Module-level
  `const NAME = <number|string|boolean literal>` is inlined (and copied into `instrumentedTs`); any other
  module-level binding: `mutable-capture`; other top-level functions: `unsupported-syntax` ("calls to other
  functions are outside subset v1"). A module string constant must be BMP text like any literal inside the function
  (`non-bmp`, span = the constant's initializer; reported by the lowering, so after phase 4; red-team round 1:
  translate() threw from `leanChar` instead). Its statement is copied verbatim into `instrumentedTs`/`plainTs`, so every
  declarator of that statement must be a literal too (`mutable-capture` otherwise). `__faithful` is reserved for the
  instrumentation runtime as the function's own name or a module constant's name (`unsupported-syntax`); parameters and
  locals may use it (see instrumentedTs).
* **Builtin names are resolved by declaration, not by spelling** (red-team round 2, moduleMathShadow). `Math.*` is the
  builtin model (Int.fdiv, iabs, ...) only when every declaration of the `Math` symbol lies outside the user's file
  (`isGlobal` in scan.ts; interface declarations, which only merge into the lib type, are ignored). Before, the test was
  "not function-local", so a module-level `const Math = { floor: (x) => x }` was modeled as the builtin while plain Node
  computed 3.5 for `Math.floor(7 / 2)`. The same test now decides `undefined` (as the nullish value in returns and
  comparisons; a module-level `const undefined = 5` is that constant, which JS module scope allows), `Error` in `throw`,
  and the `Number./String./...` library refusals. A shadowed name is lowered as an ordinary identifier, so `ident()`
  refuses it precisely (`mutable-capture` for module state, "calls to other functions" for functions). `stepOf`
  (loop measures) and `scan.ts`'s `isFloorCeilDivision` still match `Math` by spelling; that only decides whether a
  measure or a `/` is *considered*; the lowering of the same expression refuses a shadowed `Math` afterwards.
* **Declarations.** `var` refused; `let`/`const` need an initializer; destructuring refused; an unannotated `[]`
  initializer is `missing-annotation`.

## Module scan (red-team round 2, mathFloorPatched / mathAbsPatched)

Before: `translate()` looked only at the function statement and the literal constants it reads. A top-level
`Math.floor = (x) => x;` (or `Math.abs = ...`) was ignored, the builtin model was used, and `plainTs` omitted the
statement, so even the harness agreed with Lean (model 3, real module 3.5). Now every top-level statement must be
*inert*: evaluating it at module load runs no user code. Allowed: function declarations, interfaces, type aliases,
empty statements, string directives (`'use strict'`), anything `declare`d, namespaces containing only types,
`import type` (or imports whose every specifier is `type`), `export { a }` without a module specifier, `export type
... from`, enums with literal initializers, and `const`/`let`/`var` with identifier names whose initializers are inert
values: literals and operators over literals only (no operand can be an object, so no user `valueOf`/`toString`
runs), identifiers, arrow/function expressions, regex literals, and array/object literals of inert values without
spread and without non-literal computed keys (methods and accessors are defined, not run). `export default <inert>`.
Refused (`unsupported-syntax`, span = the statement): expression statements (`Math.floor = ...`, calls), classes
(static initializers/blocks, decorators and `extends` run at load; no corpus file has one), value imports and
re-exports from another module (`import "./x"`, `import { a } from "./x"`, `export * from`: they run that module's
top-level code, which can patch builtins and which the translator cannot see), `import x = ...`, `using` /
`await using` (disposers run when the module finishes evaluating), destructuring declarations (getters), any other
statement (module-level control flow). Every statement the scan allows is safe to leave out of `plainTs` and
`instrumentedTs`: it has no effect the function could observe. Residual gap, documented: an identifier initializer
can throw a TDZ `ReferenceError` at load (`const a = b; const b = 1;`); then the module cannot be imported at all and
no claim about the function is observable.

## Control flow encoding (and why break/continue are sound)

* SSA: each assignment is a fresh `let`. `if` without jumps joins the variables it modifies (`letState`); an `if` with
  a `return`/`throw`/`break`/`continue` duplicates the rest of the block into the branches that fall through
  (bounded: more than 40,000 IR nodes -> `unsupported-syntax` "control flow too complex").
* Each loop becomes `Model.<fn>_loop<k>` with parameters (captured read-only variables, [for...of: the remaining
  list], loop-carried variables). Body = `if cond then <body> else <exit>`; for...of = `match rest with [] => exit |
  x :: rest' => body`. Inside the body the continuation is explicit:
  falling off the end and `continue` = run the incrementor, then the recursive call; `break` = return the current
  loop-carried state; `return v` = `Flow.ret v` (loops without `return` return the plain state). This is exactly
  JavaScript's semantics for unlabeled break/continue in `for`/`while`/`for...of`, so break/continue are supported.
  Labels are refused. `do...while`, `for...in`, `switch`, `try` are refused.
* Termination measures (`findLoopMeasure`): for...of (structural); counting `v < E`/`v <= E` up or `v > E`/`v >= E`
  down, E loop-invariant, `v` updated exactly once either only by the incrementor or by one top-level statement of
  the body with no own `continue` (a `continue` could skip the update; tested); halving `v = Math.floor(v / k)`,
  k >= 2, under `v > c` (c >= 0) or `v >= c` (c >= 1); shrinking `xs = xs.slice(k)`, k >= 1, under `xs.length > 0`
  (or `>= 1`, `!== 0`, `!= 0`), or, for a string, `s !== ""` / `s != ""` (either operand order) with `s = s.slice(k)`.
  The first conjunct of the condition (split on `&&`) that matches wins.
  Not recognized (refused, findings): binary search style `lo <= hi` with `lo`/`hi` updated in branches, loops
  without a condition, `while (x !== 0)`.
* Recursion (`findRecursionMeasure`): every self-call is examined under the `if` conditions it sits in (let-bound
  names inlined). Number parameter passed as `p - k` (k >= 1) with a guard giving a lower bound `p >= c`, or as
  `Math.floor(p / k)` (k >= 2) under `p >= 1`: measure `(p - c_min + 1).toNat`. Array/string parameter passed as
  `p.slice(k)` (k >= 1) under a guard implying `p.length >= 1`: measure `p.length`. For a string parameter the guard
  may also be `s !== ""` or the else branch of `s === ""` (exactly `s.length >= 1` on both sides: JS `""`, Lean `[]`);
  the Lean hint discharges `0 < s.length` from `¬ s = []` with `faithful_len_pos` (Core.lean). `n === 0` as the only base case
  does not bound n from below (negative n never stops in JS either): refused, a finding. `&&`/`||` whose right operand
  contains a self-call are lowered to `if` so the left operand is a guard. Recursive calls inside loops or callbacks
  are refused (`no-termination-measure`; they would need mutual recursion / nested well-founded recursion).
* Let-bound guards (red-team round 2, r2RecGuardBoolLocal, r2RecAndLocal, r2RecStrEmptyLocal): the measure finder
  inlines lets, so `const done = n <= 0; if (done) return 0; return n + f(n - 1)` was accepted, but `decreasing_by` saw
  `h : ¬ done = true` with `done : Bool := decide (n ≤ 0)` as a let variable, and omega failed: an accepted function
  whose model did not compile (no false claim, a lean-error). Now, when a guard of any self-call mentions a let-bound
  name, the measure carries `unlet` and `decreasing_by` starts with `faithful_unlet` (Core.lean): `simp` with
  `zetaDelta := true` and only the `decide`/`Bool` connective lemmas (`decide_eq_true_eq`, `decide_eq_false_iff_not`,
  `Bool.and_eq_true`, `Bool.or_eq_true`, `Bool.not_eq_true`, `Bool.not_eq_true'`, `Bool.not_eq_false'`,
  `Decidable.not_not`) at every hypothesis, wrapped in `try`, before the pattern hints (whose `by omega` /
  `faithful_len_pos` side conditions need the unfolded guard as well). It is emitted only then, so models without
  let-bound guards are unchanged. The three probes compile with tier `proved` (axioms propext, Classical.choice,
  Quot.sound / propext, Quot.sound).
* Not changed, findings kept (round 2, held `expect=refuse`): `Math.ceil(n / 2)` halving under `n >= 2`
  (recCeilHalve2) and `Math.floor(n / -2)` under `n >= 1` (recFloorNegDiv) terminate in JS but are refused
  `no-termination-measure`; the finder knows only `Math.floor(p / k)` with a literal k >= 2.
* Lean: `termination_by <measure>` + `decreasing_by` with pattern-specific `have` hints
  (`Faithful.fdiv_lt_self`, `Faithful.sliceFrom_length_lt`) followed by `faithful_decreasing`
  (`simp_wf` / `omega` / `decreasing_tactic`). `if` conditions are emitted as decidable Props so the hypotheses are
  usable. No `sorry`, `partial` or `unsafe` is ever emitted; the Lean tests check every emitted definition's axioms
  (tier `proved`).

## Recursion depth (red-team round 1, stackDepth)

Before: `f(n) = n <= 0 ? 0 : 1 + f(n - 1)` was accepted with `Model.f_pre 100000 = true` and model value 100000,
while V8 throws `RangeError: Maximum call stack size exceeded` there (plain Node already at n ~ 9,400). The Lean model
is total; nothing excluded the depth. Now the depth is part of `range-ok`:

* `MAX_RECURSION_DEPTH` (ir.ts) = D = 500. A self-call is inside the model only when the calling activation has
  depth < D (the top-level call has depth 1), i.e. at most D activations are live. `f(n)` above is inside for
  n <= 499 and a range violation from n = 500 on (tested at the boundary in translate.test.ts and against Lean).
* Lean: for a self-recursive main function the twin is `Model.<f>_chkD (τd : Nat) ...` (same measure; `τd` is not part
  of it); each self-call evaluates its arguments, then `Faithful.ck (decide (τd < D)) "depth check failed at line N:
  f(...)"`, then calls `_chkD (τd + 1)`. `Model.<f>_chk args := Model.<f>_chkD 1 args`, so `_chk`, `_rangeOk`, `_pre`
  and `leanChkEvalExpr` keep their signatures. The model itself is unchanged.
* TypeScript: self-calls become `__faithful.rec(site, f, args...)`: arguments evaluated first (JS order, same as the
  twin), then the check, then the call under try/finally restoring the counter. Detail `depth check failed at ...`
  (classified as `range-violation`; the differential tester maps it to rangeOk = false).
* Why D = 500 (measured 2026-10-05, Node v25.8.1, macOS arm64; first depth at which the call faults with a stack
  overflow, binary search): simple `1 + f(n - 1)`: plain Node main thread ~9,400, instrumented runner on the main thread
  ~3,100, sandbox worker (4 MB stack) instrumented ~12,500. A frame-heavy function (40 locals, a `map` callback and
  string operations per level): plain ~2,150, instrumented on the main thread ~790, sandbox instrumented ~3,100. D is
  below the smallest of these with margin. Residual gap, documented: frame size is not bounded by the subset, so a
  function with much larger frames run on a small stack could still overflow at depth <= D; the TypeScript side then
  reports `fault`, which is never agreement.
* The `range-ok` words mention the bound for recursive functions.

## String length (red-team round 2, r2StrLengthLimit)

Before: `f(s) { let t = s; for (let i = 0; i < 30; i++) t = t + t; return t.length; }` had `Model.f_pre ['a'] = true`
(proved in Lean) and model value 2^30, while V8 throws `RangeError: Invalid string length` (Node v25.8.1: strings are
limited to 2^29 - 24 UTF-16 units; a string of 2^28 units is fine). Same class as round 1's recursion depth: an engine
limit the total model did not exclude. Now the string length is part of `range-ok`:

* `MAX_STRING_LENGTH` (ir.ts) = L = 2^24 = 16,777,216 UTF-16 units. Check kind `length` in `CHECKED_OPS`: the result of
  every `strConcat` (`+` and `+=` with a string operand, template literals) and every `join` has length <= L.
  Not checked, because their results are never longer than a string that already exists: `split` (pieces of the
  receiver), `slice`, `charAt`, `s[i]`, case maps (ASCII, same length), `intToStr`/`boolToStr` (short).
* Template literals: JavaScript evaluates every substitution, then concatenates. The IR is a left-nested `strConcat`
  chain; only the outermost carries the check (`unchecked: true` on the inner ones, read through `checkOf`, which every
  consumer of `CHECKED_OPS` uses). Inner results are prefixes of the outer one, so the verdict is the same, and the check
  comes after all substitutions, in JavaScript order: `` `${t}${t}${f(n - 1)}` `` with a throwing self-call throws on
  both sides even when `t + t` is too long (lean.test.ts fixture "template literal is checked after its substitutions").
* Lean twin: `Faithful.ck (decide (((x ++ y)).length ≤ 16777216)) "length check failed at line N: ..."` (the bound is
  printed from the same TS constant the runtime uses). TypeScript: `__faithful.concat(a, b, site)` (also for `+=`),
  `__faithful.template(site, head, sub, lit, ...)` and `__faithful.join(site, xs, sep?)`, each of which computes the
  result length from `String(x)` (exactly the ToString `+`, templates and `join` apply to numbers, booleans and strings)
  and fails BEFORE concatenating, so V8's own RangeError (bound 2^29 - 24 > L) is never reached. Detail `length check
  failed at ...` (classified as `range-violation`).
* Why L = 2^24 (measured 2026-10-05, Node v25.8.1, Lean 4.34.0, macOS arm64): it must be at most V8's limit, and the Lean
  twin must be able to evaluate up to it, because the harness checks `rangeOk = false` on inputs that cross it.
  `#eval` of a checked doubling loop up to the bound, net of the ~0.22 s import: 2^20 < 0.05 s, 2^24 ~0.4 s, 2^26
  ~2.5 s (the `List Char` cell is ~24 bytes). 2^24 keeps 16 M-unit strings inside the model at under a second of Lean per evaluation. Tested at
  exactly the bound (translate.test.ts: 2^24 ok, one more unit a violation; lean.test.ts: twin, rangeOk and pre against
  the instrumented runner for `+`, templates and `join`).
* The r2StrLengthLimit probe: the instrumented original now reports `range-violation` at `t + t` when `|t| = 2^24`
  (iteration 25), the twin fails the same check, `pre ['a'] = false`.
* Residual gap, documented: arrays have no length bound. V8's array limit (2^32 - 1) is unreachable before the heap is
  exhausted, and heap exhaustion (like a deep frame, see "Recursion depth") is reported by the sandbox as `fault`, which
  is never agreement; but a model theorem `pre args -> ...` still speaks about such inputs (e.g. 30 doublings with
  `xs.concat(xs)`), as it does for any input whose evaluation exhausts memory or time.

## The range-check twin (deviation from DESIGN.md's literal wording)

DESIGN.md describes `<name>_ok : ... -> Bool` mirroring the control structure. Emitted instead (same intent):
`Model.<fn>_chk : ... -> Faithful.Chk τ` (`Except Faithful.Fail`), the same control structure in A-normal form, stopping
at the first failed check (`range` / `ascii`) or at the function's own `throw` (`thrown`, where JavaScript stops too).
Then `Model.<fn>_rangeOk := Faithful.rangeOkOf (Model.<fn>_chk ...)` (Bool) and `Model.<fn>_asciiOk` likewise.
Reasons: recursion results flow through the twin without re-running the model (no exponential blow-up), and the twin
doubles as a checked interpreter whose value the tests compare with the model. Values stay pure Lean expressions in
the twin (checks are separate `Faithful.ck` lines; `&&`/ternaries guard their checks with nested `if`s), so the twin
reuses the model's termination measures. Names follow contracts.ts (`Model.<fn>_rangeOk`, not DESIGN's `<name>_ok`).
`Model.<fn>_pre` = int-bound && bmp && rangeOk && asciiOk (only the parts that apply).

Which TypeScript nodes the instrumentation checks is read off the final IR by the lowering (`collectChecked`: every
`CHECKED_OPS` primitive -> its source node and helper, every self-call -> `rec`) and passed to `instrument`, which makes
no type tests of its own. Red-team round 1: `instrument.ts` used `TypeFlags.NumberLike`/`StringLike` while the lowering
maps literal unions (`0 | 2`, `"ab" | "cd"`) to int/string, so `a % (c ? 0 : 2)`, `n * k` with `k: 2 | 3`, `s[i]`,
`s.charCodeAt(i)`, `s.toLowerCase()` on literal-union receivers were unchecked on the TS side while the twin checked
them. Verified after the change: `instrumentedTs` of all 508 functions in corpus/ and corpus-redteam/ differs from
before only on those literal-union probes (and the `rec` rewrite of self-calls).

Checked operations (`CHECKED_OPS`, shared by the twin and the TS instrumentation): `+ - *` results (and `+=`,
`++`, ...) within ±2^53 inclusive; `%`, `Math.floor(a / b)`, `Math.ceil(a / b)` divisor non-zero; `xs[i]`, `s[i]`,
`s.charCodeAt(i)` index in bounds; `toLowerCase/toUpperCase` argument ASCII; string concatenation (`+`, `+=`, the
whole of a template literal) and `join` results at most `MAX_STRING_LENGTH` units (round 2). Unary minus, `abs`, `min/max`, `.length`,
`indexOf` cannot leave the range and are not checked. Checks run in JavaScript evaluation order, inside callbacks per
element (`List.mapM`/`filterM`/`foldlM` and the `Faithful.*IM` index variants in the twin), never inside comparators.

## instrumentedTs and the runner (calling convention for engine)

`instrumentedTs`: the function statement without `export` (preceded by the inlined module constants), where each
checked operation is a call on the free identifier `__faithful` (`add`, `sub`, `mul`, `mod`, `floorDiv`, `ceilDiv`,
`at`, `charCodeAt`, `lower`, `upper`, `concat`, `template`, `join`, `rec`, `userThrow`); each helper computes exactly the
JS operation it replaces.
Hygiene (red-team round 1, faithfulParam/faithfulLocal): when the source file contains the identifier `__faithful`
(e.g. a parameter or local of that name, which shadowed the runtime and made every instrumented run fault), the first
line of `instrumentedTs` is `const __faithful_rt = __faithful;` (suffixed until fresh for the file) and the helpers
are called on the alias; otherwise the text is as before.
`plainTs` (contract, additive): the module constants the function reads (statements verbatim) followed by
`source.text`; the differential tester runs the plain original from it (red-team round 1, moduleConstBound /
moduleConstHarness: running `source.text` alone threw ReferenceError, so every input was an `instrumentation` false
alarm).
`buildInstrumentedRunner(t)` returns JavaScript source of an expression evaluating to `(args: Val[]) => Outcome`
(runtime + transpiled function + outcome mapping: ok (undefined -> null, JSON round trip), `range-violation`
(any failed check, including ascii), `throw` (the literal message), `fault` (everything else, e.g. stack overflow)).
Arguments are JSON-copied before the call. Tested: on every differential fixture the runner equals the original
whenever it does not report a violation, and Lean `rangeOk` is false exactly on the runner's range/bounds/nonzero
violations.
Scope hygiene (red-team round 3, r3RunnerNameRun/Value/Input): the transpiled function (and its module constants)
is evaluated inside a nested arrow function of its own and returned out as `__faithful_entry`; the runner calls only
`__faithful_entry`. Before, the runner's own bindings `run`, `value`, `input` shared a scope with the user's function,
so a function named `run` called the runner itself (a false `ok` outcome wrapping a fault). The runtime and the runner
now resolve every free identifier (`Math`, `BigInt`, `String`, `JSON`, ...) outside the user's scope, so a user
declaration of the same name cannot capture them. The engine's sandbox source (`instrumentedSandboxSource`,
engine/differential/instrumented.ts) uses the same structure and is loaded under the fixed name `INSTRUMENTED_ENTRY`
(r3FnNameRangeClass: a function named `FaithfulRangeViolation` had become the base class of every range violation,
turning range violations into faults). `__faithful` itself stays reserved (refused) as before.

## Lean output conventions

* Model text starts with exactly one line `import Faithful.Core`; a theorem file should *replace* that line with
  `import Faithful.Tactics` (which imports Core) rather than add a second import after the model. The model sets
  `autoImplicit false` (direct `lean` runs do not read the lakefile) and `linter.unusedVariables false`, and puts everything in
  `namespace Model`: structures (deriving `Repr, Inhabited`) with a generated `Lean.ToJson` instance, loop functions,
  the main function, the `_chk` twins, `_rangeOk`, `_asciiOk`, `_pre`.
* `ToJson` is generated, not derived: deriving would print `List Char` fields as arrays of characters and nest
  triples as `[a,[b,c]]`. Encoders are type-directed (`Faithful.jInt/jStr/jList/jOpt`, tuples as flat arrays).
* String literals are emitted as `List Char` literals (`['a', 'b']`, `'é'` escapes), which the kernel reduces
  directly (no `String.toList` in proofs).
* Emitted code refers to helpers fully qualified (`Faithful.*`, `Model.*`, `Min.min`, `Max.max`, `Int.tmod`); user
  identifiers are sanitized (ASCII only; every identifier-shaped Lean token and emitter heads such as `Faithful`,
  `Model`, `List`, `max`, `lemma` get a `_` suffix). Temporaries are `τ<n>` (user names never contain non-ASCII after
  sanitizing). Before round 4 this bullet said the keyword list "was checked empirically against Lean 4.34 with both
  imports"; it was a hand-written list and missed builtin tokens (`using`, `until`, `matches`, `repeat`, `while`, ...)
  and Mathlib's `to` (round 4, r4Tok*). It is now the parser's token table (`LEAN_TOKENS` in types.ts, 240 tokens matching
  `[A-Za-z_][A-Za-z0-9_]*`, dumped under `import Faithful.Tactics` and under `import Faithful.Core` + `import Lean`),
  and `lean.test.ts` ("Lean name hygiene") re-dumps the table under both imports and fails on any unreserved token.
  Tactic names (`simp`, `omega`) are not tokens (the tactic category reads leading identifiers as identifiers) and stay
  legal names. Checked by hand, no change needed: a parameter named like a record structure (`Point: number` next to
  `p: Point`) compiles, because the emitter writes structure names qualified (`Model.Point`).
* `leanEvalExpr` prints `{"tag":"ok","value":...}` / `{"tag":"throw","message":...}` via `IO.println` (raw JSON, not
  a Lean-quoted string). `parseLeanOutcome` maps anything else to `fault`.

## Lean runtime library (`lean/Faithful/Core.lean`)

No Mathlib. Measured warm, `lean` invoked directly with `LEAN_PATH`: a bare file 0.20 s, `import Faithful.Core`
0.21 s, `import Faithful.Tactics` (Linarith, Ring, NormNum, Positivity) 1.0-1.9 s. Helper semantics are checked against
Node on an edge-case grid (`runtime.test.ts`: slice with indices -7..6 on strings and arrays, indexOf with every
position, split edge cases, join, intToStr, ASCII case maps, tmod/fdiv/cdiv signs, strLt/strLe, charCodeAt).
Added in red-team round 1: `Faithful.length_pos_of_ne_nil` and the tactic `faithful_len_pos` (`omega`, else from a
hypothesis `¬ xs = []`), used as the length side condition of `Faithful.sliceFrom_length_lt` hints. Added in round 2:
the tactic `faithful_unlet` (see "Control flow encoding", let-bound guards); `lake build Faithful` is needed after changing Core.lean.
Added in round 3 (r3LoopEmptyStrLeft*, r3RecEmptyStrLeft*, r3RecEmptyTmplLeft): `"" !== s` with the literal on the
LEFT is accepted by both measure finders (equality with "" is symmetric and both operands are pure, so either order
is exact), but reaches `decreasing_by` as `[] ≠ s` / `¬ [] = s`, which `length_pos_of_ne_nil` did not match: the model
did not compile. Fix in the tactic, not the lowering (the unlet path produces its hypotheses through `simp`, so the
emitter does not control their orientation): `Faithful.length_pos_of_nil_ne` (`¬ [] = xs`), and, for a non-empty
guard that is one conjunct of a compound guard (`"" !== s && ...`, `!(s === "" || ...)`; the recursion finder accepts
these through `and`/`not`/negated `or`, and they failed to compile even with the literal on the right),
`Faithful.length_pos_of_eq_nil_false` closed by `subst; simp_all`. Each is a further `first` alternative of
`faithful_len_pos`, tried after the old ones; a tactic can only close the termination goal or fail, so this changes
no model's meaning. The emitted Lean text is unchanged (no golden diff).

## Red-team round 3 decisions

* Precondition `ts` expressions read no global identifier (r3ParamMath, r3ParamNumber). They are evaluated with the
  parameters bound by their TypeScript names, so `Number.isInteger(x) && Math.abs(x) <= 2^53` threw (counted as false)
  for a parameter named `Math` or `Number`, and the differential compared nothing. The int leaf is now
  `(typeof x === "number" && x % 1 === 0 && x >= -2^53 && x <= 2^53)` (operators only; `x % 1 === 0` holds exactly for
  finite integers, as `Number.isInteger`; bounds inclusive as `Faithful.inRange`). The string leaf was already
  hygienic (`typeof` and a regex literal); array leaves use the argument's own `.every` with binders `e<depth>`, which
  only shadow names inside their own callback. Not `globalThis.Number`: a parameter may be named `globalThis`.
* A `this` pseudo-parameter on a callback (r3ThisParamMap/Filter/Reduce, soundness). TypeScript erases it, so it takes
  no argument position, but `lambda()` bound `fn.parameters` positionally: `this` got the element and `x` the index.
  Now: a callback that declares `this` together with any other parameter is refused (code `this`, span = the `this`
  parameter); a sort comparator with a `this` parameter is refused likewise. A callback whose ONLY parameter is `this`
  is kept (r3ThisParamOnlyMap): the binder it gets in the element position cannot be read, because `this` in a body
  is refused by scanFeatures, so it is exactly a callback that ignores its arguments. Refusing the mixed case instead
  of dropping `this` and re-binding is the conservative choice (both are sound; the red-team expectation is refusal,
  and the main function's `this` parameter is refused too). The parameter-count message ("the array itself") no
  longer names the wrong parameter, because the `this` case is decided first.

## Red-team round 4 decisions (final fix pass)

Round 4 found 15 divergence probes in three families; all are fixed by this pass, in the sound direction (refuse, or
match JavaScript exactly). No test expectation and no golden was changed. After the pass, with Lean:
`pnpm exec vitest run packages/translate packages/engine` -> 17 files, 2321 tests, all passing (the four red-team
files: 1885 tests; arrays has 7 fewer tests than before because its tsVsLean test exists only for accepted probes).
Red-teaming was stopped after round 4 by decision, not because it ran dry: every round found new divergences
(26 / 10 / 17 / 15 divergence files in rounds 1-4), each round's cases more exotic than the last, and there is no
evidence that a fifth round would come back empty.

* Lean tokens as names (r4TokParam, r4TokLocal, r4TokField, r4TokFnName, r4TokTacticsTo; completeness, a model that
  did not parse). `LEAN_RESERVED` now contains the whole identifier-shaped token table (see "Lean output conventions"),
  so `using` -> `using_`, `to` -> `to_`, and so on, for parameters, locals, record fields (JSON keys unchanged) and the
  function's own name. No golden changed: no corpus function uses such a name.
* Comment directives (r4TsIgnoreSortStrMinus, r4TsExpectErrorSortStrMinus, r4TsNocheckSortStrMinus,
  r4TsIgnoreConstAssign, r4TsIgnoreForOfConstAssign, r4TsIgnoreForConstIndex, r4TsIgnoreDupKey; soundness). The lowering
  leaves some checks to phase 4 (string subtraction nested in a comparator, assignment to a `const`, duplicate object
  keys), and `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` hid exactly those diagnostics. Refused at the start of
  phase 4 (see "Refusal order"). Comments are enumerated through the trivia before every token, both TypeScript's
  "trailing" (same line as the previous token: `return x; // @ts-ignore`) and "leading" ranges (`findCommentMatching`,
  types.ts), so text inside string/template/regex literals never matches, and JSDoc comments (`/** @ts-ignore */`,
  which TypeScript honors) do. A directive outside the statement whose next line is a line of the statement also
  refuses (`g() { ... // @ts-ignore` newline `} export function f ...`; found in review of this pass, regression in
  refusals.test.ts). The match is anywhere in the comment text, broader than
  TypeScript's rule (directive at the start of the comment): more refusals, never a missed directive. Defense in depth,
  so the lowering no longer depends on the diagnostic: the comparator reader refuses a subtraction anywhere in the
  comparator on string keys (it looked only at the top-level expression), and an assignment to a `const` binding is
  refused in `checkAssignable` (`unsupported-syntax`). Neither changes any accepted function: both were TypeScript
  errors already.
* Module constants that do not load (r4ModuleOctalConstRead, r4ModuleLeadingZeroConstRead,
  r4ModuleOctalEscapeConstRead; an unloadable original accepted with a claimed value). `010`, `09`, `"a\1b"` (and
  `1__0`, and `const K = 010, J = 1` read through `J`) are TypeScript errors outside the function statement and
  SyntaxErrors in a strict ES module; `moduleLiteral` inlined their sloppy value. Now the lowering refuses
  (`unsupported-syntax`, span = the diagnostic) when any error diagnostic starts in the statement of a module constant the
  function reads, or a `@ts-ignore` / `@ts-expect-error` comment lies in it (the statement is copied verbatim into
  plainTs/instrumentedTs). Not extended to constants the function does not read: r4ModuleOctalConst (unread `const K =
  010`) is a held `expect=ok` probe, recorded as the documented module-load residual gap (the module cannot be
  imported at all, so no claim about the function is observable).

## Contract changes (additive)

* `LeanModel.paramNames?`: the Lean binder names of the parameters (sanitized; `max` -> `max_`). Precondition `lean`
  expressions and `names.pre` use these names, not the TS names.
* `Translation.plainTs?`: the plain original with the module constants it reads (see instrumentedTs). Optional only
  for translations stored before it existed; `translate()` always sets it.
* `LeanModel.records?`: the emitted structures (shape key, Lean name, fields with TS and Lean names). Needed by
  `valueToLean` for record values.
* Red-team round 2 (additive): `CheckKind` `'length'`; `MAX_STRING_LENGTH` (ir.ts); `checkOf(e)` (ir.ts), the only
  way to read `CHECKED_OPS` for an expression; `Expr` prim field `unchecked?: true` (inner template concatenations);
  `Measure.unlet?` on `int`/`length` measures; `isGlobal` exported from scan.ts; `__faithful.concat/template/join`
  runtime helpers; the `range-ok` precondition words mention the string bound.
* Round 4 (additive, types.ts, not re-exported from the package index): `isLeanReserved`, `findCommentMatching`, `findLineDirectiveFor`,
  `TS_LINE_DIRECTIVE`, `TS_FILE_DIRECTIVE`; `Lowerer` takes the file's error diagnostics as an optional last argument.
* New exports: everything in `ir.ts`; `translateWithIr`, `REFUSAL_CODES`, `sha256Text`, `leanPredicateExpr`,
  `leanChkEvalExpr`, `FAITHFUL_TS_RUNTIME`, `buildInstrumentedRunner`, `leanTy`, `encoder`, `leanStr`, `leanStrList`,
  `leanIdent`.

## Known gaps / not done

* No interval measure (binary search over `lo..hi`), no lexicographic measures, no mutual recursion.
* `for...of` over strings refused (it iterates code points; equal to units under BMP, but not in the v1 list).
* Option-typed locals refused; `includes/startsWith/endsWith/trim/repeat/padStart` on strings refused (not in the v1
  library list).
* Duplicated continuations can make large functions hit the 40,000-node bound.
* Module scan (round 2) refuses every value import, side-effect import, re-export and class at module level, even
  when harmless; refusals, not claims. Arrays have no length bound (see "String length").
* The model of `s[i]`/`charCodeAt` out of range is an arbitrary total value (excluded by `rangeOk`); specs should not
  depend on it.
