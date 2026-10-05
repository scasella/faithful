# packages/smt: the bounded SMT tier ("Verified to k")

Written 2026-10-05. Toolchain for every number here: Node v25.8.1 (darwin-arm64), TypeScript 5.9.3, Z3 via `z3-solver`
5.2.0 (WASM) and system z3 5.1.0 (`/opt/homebrew/bin/z3`), Lean 4.34.0 (sanity's Lean leg). No model call anywhere in
this package; model id `gpt-6-luna` appears only because every stamp carries one.

## What the claim is

"Verified to k": Z3 found no distinguishing input among all inputs up to the stated bounds, under the encoding below.
`unsat` at bounds (A, S, B, U) means: for every input with every array of at most A elements, every string of at most S
UTF-16 units of BMP text, every number an integer in [-B, B], on which

* the ORIGINAL stays inside the model (no range/bounds/nonzero/length/ascii/recursion-depth check fails: the checked
  twin's `range-ok` and `ascii`), and
* both functions finish within U iterations of each loop entry (a loop of exactly U iterations is included; see Loops
  and recursion) and U nested activations of a recursive function,

the two outcomes are equal: same returned value, or same thrown message. A candidate that leaves the model (overflows,
indexes out of range, ...) where the original does not is a difference. Nothing is claimed for larger inputs, wider
integers, or inputs needing more than U iterations (those are excluded by assertion, not approximated). The text is
`encodingNote(bounds, U)`; it is attached to every result and to `SmtDetail.encoding`.

**Coverage (added after red-team round 1, rewritten after round 2).** The exclusion above is checked, never silent.
`unsat` is reported only when (1) the checked set is non-empty (some input inside the bounds has the original inside
the model and both runs finishing within U), and (2) no input inside the bounds whose integers are all in [-1, 1]
needs more than U iterations, and (3) when other inputs inside the bounds need more than U iterations, the reported
integer bound is NARROWED to one inside which Z3 checked that no input does. Failing (1) is `unknown` ("vacuous",
`coverage.kind = 'vacuous'`); failing (2) is `unknown` ("size-driven", with the input as `coverage.example`;
`verifiedToK` then raises U). For (3) the result's `bounds.int` is the narrowed bound B' (`coverage.kind =
'int-driven'`, `coverage.intBound` = B', `coverage.requestedInt` = the bound asked for, `coverage.example` = an
excluded input, whose largest |integer| is above B'), and `encodingNote` is written for the narrowed bounds plus a
sentence in capitals, "SOME INPUTS INSIDE THESE BOUNDS WERE EXCLUDED ... The claim above is therefore NARROWED to
integers in [-B', B']". So `unsat` is exact for the bounds it reports: every input inside them was checked. When no
input is excluded the note says so (`coverage.kind = 'full'`, bounds as requested). "Integers" here are number
parameters and number elements/fields of arrays (below the length), tuples and records; string code units, booleans
and lengths are not, so an exclusion driven by those survives every integer box and is refused at (2).

*What round 2 broke, and why the rule changed.* The round-1 rule (2) was "no excluded input has every integer 0", and
any other exclusion was labelled "int-driven" while `unsat` kept the REQUESTED bounds. That classification is not
sound: it tests what gates a loop, not what drives it. R2-V4: `if (n === 0) return 0;` before a loop over
`100 * xs.length` (likewise a throw at 0, `12 % n` leaving the model at 0, a guard on `xs[0] === 0`) keeps the all-zero
input away from the loop, so the length-driven exclusion was labelled int-driven and `verifiedToK` reported "Verified
to 6" although (1, [0]) differs. r2MergeCapIntGatedDiffer: a two-pointer merge stops early when every element is 0
but needs a.length + b.length steps when values interleave, so the same happened at the default bounds with the
witness [[1,3,5,7,9,11],[2,4,6,8,10,12]] inside them. No probe at pinned integer values can decide what drives an
exclusion (a guard defeats any such probe), so the check no longer classifies; it narrows the integer bound until the
claim is exact. The [-1, 1] cutoff in (2) is POLICY, not the soundness argument: it decides when narrowing is not
worth it (and U should be raised instead). A pair that guards |n| <= 1 passes the cutoff and gets a TRUE but weak claim
at integers ±1, visibly labelled; it is never a claim at the requested bound.

How B' is found (`coverageCheck`, equivalence.ts): one solver call with four sections (excluded ∧ all integers 0,
excluded ∧ all integers in [-1, 1], excluded, checked set ∧ integers in [-1, 1]); then excluded ∧ box(M - 1) where M
is the largest |integer| of Z3's excluded example (often exact: one section); if that is not `unsat`, powers of two
below M, smallest first, three per call, stopping at the first that is not `unsat`. Every certified box contains the
smaller ones, so the certified bound is sound even when it is not the largest. If the checked set inside [-1, 1] was
empty, one more call checks it inside [-B', B'] (else `unknown`, "vacuous"). Any Z3 unknown/timeout before a box is
certified is `unknown`/`timeout`, never `unsat`. The round-1 behaviour "Z3 could not decide whether inputs were
excluded -> `unsat` at the requested bounds" is gone (it was an overclaim too): it now narrows like int-driven
(`coverage.kind = 'unknown'`, no example).

## Layout

| file | role |
|---|---|
| `terms.ts` | SMT-LIB term strings, exact folding (literal booleans/ite, + - * and comparisons of BigInt literals; never div/mod), `Smt` script builder (`def` names every compound term: the script is a DAG) |
| `intsem.ts` | `tmod`, `fdiv`, `cdiv`, `iabs`, `inRange` written from the SMT-LIB `div`/`mod` definition (see below) |
| `values.ts` | symbolic values (SV), `merge` (ite), `svEq`, decoding a model to `Val`, constants |
| `seq.ts` | bounded sequences: select, concat, slice, strLt/strLe, indexOf, split, join, intToStr, boolToStr, case maps |
| `encode.ts` | `Encoder`: IR to SMT by symbolic evaluation with statuses; `unsupportedConstructs` (static pre-pass) |
| `inputs.ts` | symbolic inputs and their domain (`Bounds`) |
| `outcome.ts` | status/model to `Outcome` |
| `replay.ts` | `runInstrumented`: both functions in the engine's sandbox, range-instrumented |
| `equivalence.ts` | `checkEquivalent`, `verifiedToK` (adaptive k), `encodingNote`, `DEFAULT_STEPS` |
| `sanity.ts` | `sanityCheck`, `sanityReport` (CLI: `node packages/smt/scripts/sanity-report.mjs [--system|--wasm] [--n 60]`) |

Dependencies: core, translate, engine (Sandbox, generateInputs, loadCorpus, instrumented source, outcomeEqual),
session (type `SmtDetail` only). No cycle: engine and session depend only on core and translate (checked in their
package.json files). Adding the two workspace deps added two `link:` importer lines to `pnpm-lock.yaml` (`pnpm install
--offline`); nothing else in the lockfile changed.

## Encoding decisions

**Statuses.** Every IR expression evaluates to `{st, v}`. `st` is an Int: 0 normal, 1 fuel exhausted, 2+m `throw`
of message m (a table shared by both encoders of a query, so equal messages get equal codes), 1,000,000+c check c
failed. `checks[c]` is the exact detail the instrumented original reports (`<kind> check failed at line L: <text>`),
which lets sanity mode compare range violations by detail (that checks check ORDER, not only presence). Statuses
compose in JavaScript evaluation order: arguments left to right, then the operation's own check (`checkOf`, so inner
template-literal concatenations stay unchecked), `&&`/`||` evaluate the right operand's status only when it runs, the
depth check `depth < 500` comes after a self-call's arguments. Values are only meaningful under status 0.

**Integers** are SMT `Int`, exactly. SMT-LIB `div`/`mod` are Euclidean (0 <= mod < |b|), never JavaScript's:
* `a % b` = `mod a b` when a >= 0, else `-(mod (-a) b)` (sign of the dividend);
* `Math.floor(a / b)` = `div a b` when b > 0, else `div (-a) (-b)` (`div` is the floor only for positive divisors);
* `Math.ceil(a / b)` = `-floor(-a / b)`.
Division by zero is total but unspecified in SMT-LIB; the `nonzero` check always precedes the value. Tested against
JavaScript's own `%`, `Math.floor(a / b)`, `Math.ceil(a / b)` on 567 operand pairs (signs, ±1, ±2^53, ±(2^53-1),
3^33, ...) with symbolic and literal operands, through both drivers (`intsem.test.ts`). The `range` check is
`-2^53 <= r <= 2^53` (inclusive, exact). After a failed range check the value passed on is 0 (it is never observed):
without that, repeated squaring after an overflow built numbers with millions of digits (numeric/intPow timed out
in sanity mode before this; exactness argument: every integer that is observed under status 0 is within ±2^53, since
inputs are, and every operation that can leave the range is checked).

**Sequences** (arrays and strings) are a length term plus a static number of element slots (the capacity); strings
hold Int code units. Padding slots are unconstrained and never read (every read is guarded by `j < len` or a bounds
check). Capacities are static and exact: concat = sum, slice with a literal start k >= 0 drops k slots, `matchList`
tails drop one slot, `split` parts carry a bound on their total length so `join` of a split is not quadratic.
`if` merges pad by taking the slot of whichever side has it. Symbolic indexing is an ite chain over the possible
slots. The operations implement `PRIM_DOC` exactly: slice/relative indices with JavaScript clamping, `indexOf(t, pos)`
with `pos` clamped and the empty needle found at the clamped position, `split` with the empty separator (one string per
unit, `""` -> `[]`) and otherwise leftmost non-overlapping matches (`""` -> `[""]`), symbolic separators included,
`join` (default `","`), `intToStr` (digits by `div`/`mod` by constant powers of ten, at most 17 slots), `boolToStr`,
string `<`/`<=` lexicographic by code unit, ASCII case maps with the `ascii` check, `charAt` (`""` out of range),
`charCodeAt`/`s[i]`/`xs[i]` with the `bounds` check, `length` checks static when the capacity is below 2^24.

**Records / tuples / state**: fields by name / position. **Option**: a `some` flag plus the inner value. **Flow**
(loops that `return`): an `isRet` flag, the returned value and the next state.

**Callbacks** (`map`, `filter`, `reduce` and their index forms) are inlined once per slot; a slot's status counts only
when the slot is below the length. `filter` compacts with prefix counts. **Sort** is a bubble network that swaps
neighbours only when strictly out of order by the translated key (stable), i.e. the unique stable sort that
`List.mergeSort` and ES2019 `Array.prototype.sort` produce.

**Loops and recursion.** Calls are inlined. A loop function gets fuel U per loop entry, counted in iterations: U
completed iterations take U + 1 activations (the last one is the exit test), so its (U+2)-th nested activation has
status "fuel". **Correction (red-team round 2, R2-L1):** until round 2 the (U+1)-th activation was fuel, so a loop of
exactly U iterations was excluded while `encodingNote` said "finish within U iterations" (r2v09: a fixed 4-iteration
loop at U = 4 answered "vacuous"). The count now matches the wording; a loop of U + 1 iterations is still excluded
(regression test). Every U-dependent number below that predates round 2 was measured with the old count. The main function's self-recursion likewise, after the twin's depth check. `for...of` loops
(measure `list-length`) recurse on a tail whose capacity shrinks, so they are unrolled by capacity and never exhaust
fuel. Identical calls (function, depth, argument terms) are encoded once, but for recursion on integers the memo
almost never hits. **Correction (red-team round 1, V2):** an earlier version of this file said `n - 1 - 1` and `n - 2`
print identically and that doubly recursive `fib` is therefore quadratic in U. That was false: a range-checked
`n - 1` becomes a fresh name `ite(ok, n - 1, 0)`, so `(n - 1) - 1` and `n - 2` are different terms and both branches
are unrolled in full. Measured by the red team: test-suite `fib` encoding 21,014 characters at U = 4, 1,558,284 at
U = 10, 26,303,471 at U = 14 (doubling per U); a loop with `continue` (c03) also doubles per U because the IR
duplicates the continuation. Such pairs answer `unknown` ("did not complete") above the 40,000,000-character budget,
never a claim. Not fixed (open issue).

The encoder recurses on the JavaScript stack once per unrolled activation. A JavaScript stack overflow during encoding
(seen at U = 520 on the default vitest worker stack) is caught and reported as `unknown` ("the encoder ran out of
JavaScript stack at U = ...; bounds did not complete"); it was previously thrown out of `checkEquivalent`.

**Unsupported.** `unsupportedConstructs` walks every function body before any encoding (so a construct behind a dead
or fuel-exhausted branch is still reported) and the query returns `unsupported: <construct>`. Today every primitive the
translator emits is encodable; the pre-pass reports only structural impossibilities (callbacks outside
map/filter/reduce/sort, unknown calls, a sortBy without a recognized comparator), none of which the translator
produces. Signature mismatches between original and candidate are also `unsupported`. **Finding: 39 of 39 in-subset
corpus functions are fully encodable; the unsupported-construct list over the corpus is empty.**

## Equivalence query

Both IRs over the SAME symbolic inputs. Asserted: input domain (bounds; BMP code units 0..0xFFFF minus
0xD800..0xDFFF, as `tsPred`/`Faithful.bmp` + Lean `Char`), original status is 0 or a throw, candidate status is not
fuel, and (statuses differ or both normal and values differ). The script has two sections separated by `(reset)` (one
solver call, so a driver that answers once still gets a complete step): the query, then the checked set alone. Then:
* `unsat` and the checked set empty -> `unknown`, reason "vacuous: ...", nothing claimed (V1: a fixed 12-step loop at
  U = 10, an original that overflows on every input).
* `unsat`, and some activation reached U (`Encoder.fuelUsed`) -> the coverage check above (with `excluded = original
  reaches U, or candidate reaches U while the original is inside the model`): an excluded input with every integer
  in [-1, 1] -> `unknown`, "size-driven"; no excluded input -> `unsat`, full coverage; otherwise `unsat` with
  `bounds.int` narrowed to a certified B' (int-driven, or `unknown` coverage when Z3 could not produce an example).
  A timeout or unknown before a box is certified is `timeout`/`unknown`, never `unsat`.
* `unsat` otherwise -> verified at these bounds, full coverage.
* `sat` -> the input is decoded and replayed on BOTH range-instrumented functions in the sandbox. `sat` is reported
  only when the replayed outcomes differ, neither faulted, and the original's replay is not a range violation; the
  outcomes in the result are the replayed ones (`predicted` keeps the encoder's view for diagnosis). Otherwise
  `inconclusive (encoder disagrees with execution)`. A sandbox fault is never a counterexample.
* Z3 `(error ...)` in the transcript is `unknown` with the text, never `unsat`. An encoding over the size budget is
  `unknown` ("did not complete").

## Adaptive k

`DEFAULT_STEPS`: (arrays 2, strings 2, ints ±2^4, U 4), (4, 4, ±2^8, 6), (6, 6, ±2^12, 8), (6, 8, ±2^16, 10): ends at
the brief's defaults. Each step gets the remaining wall-clock budget. A step answering `unknown` because inputs inside
its bounds need more than U (size-driven, or vacuous with fuel) is retried at the same bounds with U doubled, up to
`MAX_UNROLL` = 64; every try is in `attempts`, the result's `unroll` and `encodingNote` carry the U it was obtained at,
and later steps start at the largest U a completed step needed. Example (concat index loop, red-team
`fuelConcatIndexLoopDiffer`): unknown@U4, unsat@U8, unknown@U8, unsat@U16, sat@U16 (replay-confirmed). A loop that no
U up to 64 covers (a trip count of `charCodeAt(0) + 20`) ends the run as `unknown` and k is the last completed step. `unsat` continues; `sat`, `inconclusive`,
`unsupported` end the run at that step; `timeout`/`unknown` end the run and the result is the last completed step
(or k = 0 with "No bound completed; nothing is claimed"). A k that did not complete is never claimed; the next
step's failure is spelled out in `SmtDetail.encoding`.

`SmtDetail.k` is one number while arrays and strings have separate bounds: k = min(array bound, string bound) (the
conservative reading), and `bounds` plus U are always printed. `SmtDetail.result` has no `unsupported` or
`inconclusive`; `verifiedToK` returns `detail: null` for those (the full result carries the reason). The session owner
should add those two members to the union (open issue).

## Sanity mode

Per function: one encoding at capacities that fit every input (symbolic lengths), then per input `(reset)`, the
encoding, `(assert input = constants)`, `(check-sat)`, `(get-value status+output)`. A second pass asserts that the
decoded output is the only one the encoding allows for that input (`unsat` expected): an encoding whose output depended
on padding would pass the first pass by luck. Compared against the range-instrumented original in the sandbox
(outcomes including range-violation details) and, when Lean is available, the Lean checked twin `#eval`
(`leanChkEvalExpr`). Inputs: engine `generateInputs` (seed 20261005, arrays <= 6, strings <= 8, ints mostly small plus
±2^53 boundaries). U starts at 24 and is lowered when the encoding exceeds 8 MB.

Why `(reset)` and not `push`/`pop`: under push/pop Z3 uses its incremental core without the preprocessing that
substitutes the input constants; numeric/collatzSteps (24 nested div/mod) then ran > 60 s per input instead of ~5 ms.

Measured 2026-10-05 (`pnpm exec vitest run packages/smt/src/sanity.test.ts`, system z3 5.1.0, real Lean):
**39 functions, 39 encodable, 2,340 inputs, 2,244 compared with the instrumented original (2,244 agreements), 2,244
compared with Lean's checked twin (0 differences), 2,340 uniqueness checks, 84 inputs not compared because the encoder
reached U (fuel), 12 because the TypeScript side faulted (timeout at 500 ms), 0 mismatches.** 188 s total; the slow
ones are string/repeatString (65 s, 5 MB encoding at U=16, string capacity grows with every iteration),
recursive/fibonacci and numeric/fibRecursive (~25 s each, U lowered to 10) and string/toCsvRow (19 s).
`library.test.ts` adds 17 purpose-built functions for operations the corpus does not exercise (intToStr/boolToStr in
templates, split with a symbolic separator, string comparisons, string-key and plain string sorts, index callbacks,
indexOf/includes on strings, join of numbers/booleans, negative slice indices, indexOf with position, charCodeAt,
case maps, ceil division/abs/min/max, option results, tuples, recursion): 0 mismatches.

The harness is not vacuous: replacing `tmod` with plain `mod`, or swapping the separator order in `join`, makes the
library sanity tests fail (checked by hand 2026-10-05, then reverted).

## Measured query times (default k: arrays 6, strings 8, ints ±2^16, U 10)

`equivalence.test.ts` pairs, total time per query including replay (Z3 time in parentheses where it dominates):

| pair | system z3 5.1.0 | WASM z3-solver 5.2.0 |
|---|---|---|
| known-different (8 pairs: off-by-one, wrong comparison, missing case, overflow-only, empty array, thrown message, string slice, sort direction) | 10-21 ms each | 138-235 ms each |
| sum loop vs reduce / filter count vs loop / floor-mod recombination | 7-17 ms | 157-253 ms |
| string reverse loop vs recursion | 35 ms | 367 ms |
| (a+b)^2 vs a^2+2ab+b^2 (nonlinear) | 261 ms | 1,704 ms |
| iterative vs recursive fib (1.5 MB encoding) | 802 ms | 3,679 ms |

WASM pays about 130-150 ms per query for worker start and WASM instantiation.

Re-measured 2026-10-05 after the coverage check (same toolchain, `pnpm exec vitest run packages/smt`): an `unsat` now
costs the query plus the non-emptiness section, plus a second solver call when a loop or recursion reached U. Iterative
vs recursive fib (1,562,204 characters, integer-driven exclusion): 2,363 ms system (was 802), 9,441 ms WASM (was
3,679). Algebraic forms: 442 ms system, 2,048 ms WASM. String reverse: 68 ms / 760 ms. Known-different pairs are
unchanged in kind (one call; the extra section is solved too): off-by-one loop 25 ms system, 296 ms WASM. The corpus
run below predates the coverage check and was not repeated.

Re-measured 2026-10-05 after the round-2 fixes (fuel counts iterations, integer narrowing; `pnpm exec vitest run
packages/smt`, 10 files, 522 tests passed, 258 s wall): iterative vs recursive fib now narrows to integers ±10 at
U = 10 (example [11]) in four solver calls (query 2.1 s, coverage 1.8 s, the M - 1 rung 0.9 s on system z3): 6,460 ms
system (was 2,363), 36,184 ms WASM (was 9,441). Algebraic forms 486 / 2,136 ms, string reverse 91 / 792 ms (no
fuel, unchanged path). A pair whose exclusion is size-driven under a guard (the R2-V4 shapes) costs one extra call per
U doubling up to 64: about 30 s for `12 % n` + `100 * xs.length` in `coverage-r2.test.ts`.

Corpus run (scratch script, 2026-10-05, system z3): every in-subset corpus function against itself (39 `unsat`) and
against up to 6 engine mutants each (`generateMutants`, seed 7; 196 translatable mutants): 188 `sat`, every one
replay-confirmed, 8 `unsat`, 0 `inconclusive`, 0 `unknown`. Query time median 18 ms, p90 302 ms, max 24.9 s
(string/repeatString mutants; its string capacity grows with every unrolled iteration). The 8 `unsat` mutants were each
run against the original on 1,500-3,000 generated inputs with no difference (they look like equivalent mutants:
`<` vs `<=` where the boundary case returns the same value, a redundant empty-string guard, ...).

## Budget

`checkEquivalent` passes its remaining budget to the driver: WASM terminates its worker, the system driver uses
`-T:` (whole seconds, rounded up) plus a process-group kill 2 s later. The budget test (a^3 + b^3 = c^3 with
positive a, b, c vs `0`) returns within 3.1 s of a 3 s budget on both drivers; `k` reflects the last completed step.

## Known limits (honest)

* The claim is bounded: only inputs up to the bounds, and only inputs on which both functions finish within U
  iterations. A loop that runs `n` times for an integer parameter is covered only for small `n` (n <= ~U): the bound
  B = 2^16 on integers does not mean every n up to 2^16 was explored when n drives a loop. Since round 2 the result
  then REPORTS the narrowed integer bound B' (e.g. iterative vs recursive fib at the default step: arrays 6, strings
  8, integers ±10 at U = 10, not ±2^16), with the requested bound and an excluded example in the note. An exclusion
  with every integer in [-1, 1] is refused (`unknown`).
* B' is certified, not necessarily the largest: when Z3's excluded example is not the smallest excluded magnitude,
  B' is the largest certified power of two below it (an under-claim). Inputs with integers beyond B' that finish within
  U were also checked (no difference), but nothing is claimed for the integer range beyond B' as a whole.
* `SmtDetail` has a single `bounds.int`; after narrowing it is B'. `SmtDetail.k` (sequence bound) is unchanged by
  narrowing, so a consumer that prints only k and not the bounds would overstate; the bounds are always in the detail.
* Doubly recursive functions on integers and loops with `continue` encode exponentially in U (memo misses, see Loops
  and recursion); they answer `unknown` at large U.
* A deep U (hundreds) can exhaust the JavaScript stack while encoding: reported as `unknown`, the depth-500 check is
  therefore not reachable through `checkEquivalent` on a default stack (it is encoded and was confirmed correct by the
  red team with `node --stack-size=60000`).
* `-0` is not modeled (the translator documents it as unobservable in subset v1).
* The recursion-depth check is encoded, but with U < 500 fuel always runs out first; it matters only for U >= 500.
* Encoding sizes grow quickly with string capacity in loops that build strings (repeatString); such queries can be
  slow or exceed the size budget at the default k, which is reported as "did not complete", never as a claim.
* Sanity mode compares only inputs where the encoder finished (fuel inputs are counted, not compared).
