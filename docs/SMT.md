# The SMT tier: "Verified to k"

This document describes `packages/smt`: how the translator's IR is encoded for Z3, what the label "Verified to k" means
and does not mean, how k adapts, how a counterexample is decoded and replayed, sanity mode and its corpus result, the
unsupported-construct finding, the Z3 drivers and their timings, and the red-team history. `packages/smt/NOTES.md` is
the running decision log. The code is the contract: `packages/smt/src/equivalence.ts` (`checkEquivalent`,
`verifiedToK`, `encodingNote`), `encode.ts` (`Encoder`, `unsupportedConstructs`), `inputs.ts`, `seq.ts`, `intsem.ts`,
`replay.ts`, `sanity.ts`, `z3.ts`. Where this document and the code differ, the code wins and this document is wrong.

Written 2026-10-05. Every number measured for this document was taken that day on this machine (darwin-arm64) with:
Node v25.8.1, TypeScript 5.9.3, system Z3 5.1.0 (`/opt/homebrew/bin/z3`), WASM Z3 from `z3-solver` 5.2.0, and Lean
4.34.0 (`leanprover/lean4:v4.34.0`, commit `293d5d0c`), which is what `lake env` resolves inside `lean/`. (The elan
default outside `lean/` is 4.34.1; the harness never uses it, because `loadLeanEnv` asks `lake env which lean` in
`lean/`.) No model call happens anywhere in this package. Numbers quoted from NOTES.md or from the red-team test
headers say so.

Contents

1. Status in this build
2. What "Verified to k" means, and what it does not mean
3. The encoding
4. The equivalence query and its coverage check
5. Adaptive k: defaults and what was achieved
6. Counterexamples: decode and replay
7. Sanity mode and its corpus result
8. Unsupported constructs (a finding)
9. Z3 drivers: WASM in Node, system fallback, timings
10. Red-team history
11. Known limits and open issues

---

## 1. Status in this build

The SMT tier exists as a library with its tests: `checkEquivalent` (one bounded query) and `verifiedToK` (the adaptive
driver that produces a `SmtDetail` for the session). **The CLI does not call it yet.** `SessionRuntime.smt` is declared
(`packages/cli/src/flow/runtime.ts`) and never assigned; `packages/cli/src/api.ts` only has a comment about wiring it.
The CLI uses this package only in `faithful doctor` (`doctor.ts` opens a driver and reports its kind and version);
`optimizeCmd.ts` imports `openZ3` but only references it (`void openZ3;`). As docs/TIERS.md
states, the SMT stage of every candidate is therefore recorded as `skipped` in this build, and no candidate reaches the
`verified-to-k` tier through the CLI. Everything below is about the library and the measurements made with it.

## 2. What "Verified to k" means, and what it does not mean

### Means

Z3 answered `unsat` to the bounded query, and the coverage check (section 4) passed. In the words `encodingNote`
attaches to every result (and to `SmtDetail.encoding`): Z3 found **no** input

* with every array of at most A elements, every string of at most S UTF-16 units of BMP text, and every number an
  integer in [-B, B],
* on which the **original** stays inside the model (its `range-ok` holds, and `ascii` where it applies: no range,
  bounds, nonzero, length, ascii or recursion-depth check fails),
* and on which both functions finish within U iterations of each loop entry and within U activations of the recursive
  function,

where the two outcomes differ: a different returned value, a different thrown message, a throw against a return, or
the **candidate** leaving the model where the original does not.

`k` is `min(A, S)` (the conservative reading of one number for two sequence bounds). k, A, S, B and U are always
reported together: `SmtDetail` carries `k` and `bounds`, and `encodingNote` spells out A, S, B and U.

Since red-team round 2 the excluded inputs are **checked, not assumed away**: an `unsat` is reported only when Z3 also
showed that (1) at least one input inside the bounds is checked at all, and (2) no input inside the reported bounds
needs more than U iterations. If some inputs need more than U iterations only at larger integers, the integer bound B
is **narrowed** to a certified B' and the result reports B', never the requested B (section 4). So an `unsat` is exact
for the bounds it reports: every input inside them was covered.

### Does not mean

* **Not a proof.** It says nothing about arrays longer than A, strings longer than S, integers outside [-B, B] (or
  [-B', B'] after narrowing), or inputs that need more than U loop iterations or recursive activations. Those inputs
  are not approximated; they are outside the claim.
* Nothing about inputs on which the original itself leaves the model (they are excluded by the `range-ok`
  precondition, exactly as in the Lean tier).
* Nothing about the spec: the query compares the candidate with the original only.
* Nothing about JavaScript directly. Both sides are encoded from the translator's IR, not from the running code and not
  from the Lean text. Sanity mode (section 7) and replay (section 6) are what tie the encoding to execution, and both
  are tests, not proofs.
* `-0` is not modeled (the translator documents it as unobservable in subset v1); astral characters and lone
  surrogates are outside the string domain (the `bmp` precondition).
* A large requested integer bound does not mean that loops driven by an integer were explored up to it. A loop that
  runs `n` times is covered only for `n` up to about U; that is exactly the case where the reported bound is narrowed
  (for example iterative vs recursive fib: integers ±10 at U = 10, not ±2^16).

## 3. The encoding

`Encoder` (`encode.ts`) symbolically evaluates the IR. Every expression evaluates to `{st, v}`.

**Status `st`** (an SMT `Int`): `0` normal (`ST_OK`), `1` fuel exhausted (`ST_FUEL`, the unrolling bound was
reached), `2 + m` a `throw` of message m (`THROW_BASE`; the message table is shared by both encoders of one query, so
equal messages get equal codes), `1,000,000 + c` check c failed (`VIOL_BASE`; `checks[c]` is the same detail text the
instrumented original reports, `<kind> check failed at line L: <text>`). Statuses compose in JavaScript evaluation
order: arguments left to right, then the operation's own check (`checkOf` from `translate/src/ir.ts`), `&&`/`||`
evaluate the right operand's status only when it runs, the depth check comes after a self-call's arguments. `v` is
meaningful only under status 0.

**Representation of each type** (inputs: `inputs.ts` `declareInput`; values: `values.ts`):

| subset type | SMT representation | input domain asserted |
|---|---|---|
| `int` (`number`) | an SMT `Int`, exact (no bit-vectors, no floats) | integer in [-B, B], B <= 2^53 (the `int-bound` precondition) |
| `bool` | an SMT `Bool` | none |
| `string` | a length term plus S slots of `Int` code units | 0 <= length <= S; every unit below the length in 0..0xFFFF minus 0xD800..0xDFFF (the `bmp` precondition, as `Faithful.bmp` and Lean `Char`) |
| `array` | a length term plus A element slots, each element encoded recursively | 0 <= length <= A; each element below the length in its own domain |
| tuple / record | one value per position / field name | field by field |
| option (return type only) | a `some` flag plus the inner value | not an input |
| loop that `return`s ("flow") | an `isRet` flag, the returned value and the next state | internal |

Padding slots (index >= length) are unconstrained and never read: every read is guarded by `j < len` or by a bounds
check. Capacities (slot counts) are static and exact: `concat` adds them, `slice` with a literal start k >= 0 drops k,
`for...of` tails drop one, `split` parts carry a bound on their total length, an `if` merge takes the larger side.
Symbolic indexing is an `ite` chain over the possible slots.

**Integer operations** (`intsem.ts`). SMT-LIB `div`/`mod` are Euclidean (0 <= mod < |b|), never JavaScript's, so:

* `a % b` (`tmod`) = `mod a b` when a >= 0, else `-(mod (-a) b)` (sign of the dividend);
* `Math.floor(a / b)` (`fdiv`) = `div a b` when b > 0, else `div (-a) (-b)`;
* `Math.ceil(a / b)` (`cdiv`) = `-floor(-a / b)`;
* `Math.abs`, `Math.min`, `Math.max` with `ite`; `+ - *` exactly.

The `nonzero` check precedes every division value (SMT-LIB division by zero is total but unspecified). The `range`
check after `+ - *` is `-2^53 <= r <= 2^53`, inclusive and exact. After a failed range check the value passed on is 0;
it is never observed, because status is no longer 0. These definitions are tested against JavaScript's own `%`,
`Math.floor(a / b)` and `Math.ceil(a / b)` on 567 operand pairs (count per NOTES.md) (signs, ±1, ±2^53, ±(2^53 - 1), 3^33, ...) with symbolic
and literal operands, through both drivers (`intsem.test.ts`; passed in this document's run, section 9).

**Strings and arrays** (`seq.ts`) implement `PRIM_DOC` (`translate/src/ir.ts`): slice with JavaScript clamping and
negative indices, `indexOf(t, pos)` with `pos` clamped and the empty needle found at the clamped position, `split`
(empty separator: one string per unit, `""` gives `[]`; otherwise leftmost non-overlapping matches, `""` gives `[""]`;
symbolic separators included), `join` (default `","`, numbers through `intToStr`, booleans through `boolToStr`),
`intToStr` by `div`/`mod` with constant powers of ten (at most 17 slots), string `<`/`<=` lexicographic by code unit,
ASCII case maps with the `ascii` check, `charAt` (`""` out of range), `charCodeAt`/`s[i]`/`xs[i]` with the `bounds`
check, and the `length` check (2^24 units) on concatenation and `join`.

**Callbacks** (`map`, `filter`, `reduce` and their index forms) are inlined once per slot; a slot's status counts only
when the slot is below the length. `filter` compacts with prefix counts. **Sort** is a bubble network that swaps
neighbours only when strictly out of order by the translated key: the stable sort, which is the unique result
`List.mergeSort` and ES2019 `Array.prototype.sort` both produce for the accepted comparators.

**Loops, recursion and the fuel bound U.** Calls are inlined (`Encoder.inline`).

* A loop function gets fuel U **per loop entry, counted in iterations**: a loop that completes U iterations takes U + 1
  activations (the last one is the exit test), so activation U + 2 has status "fuel". (Red-team round 2, R2-L1: it used
  to be activation U + 1, which excluded loops of exactly U iterations while the note said "within U iterations".)
* The recursive main function: an activation deeper than U has status "fuel", i.e. at most U activations (the
  top-level call plus U - 1 nested self-calls). `encodingNote` words this as "U nested calls of a recursive function",
  which is one more than the encoder allows (see section 11).
  The twin's recursion-depth check (`depth < 500`) is encoded before every self-call, but with U < 500 fuel always runs
  out first.
* `for...of` loops recurse on a tail whose capacity shrinks by one slot, so they are unrolled by capacity and never
  exhaust fuel.
* Identical calls (function, depth, argument terms) are encoded once. For integer recursion this memo rarely hits (a
  range-checked `n - 1` is a fresh name), so doubly recursive functions and loops with `continue` grow exponentially in
  U (section 11).

Fuel is never silent: any activation that reaches U sets `Encoder.fuelUsed`, and the query then runs the coverage
check (section 4).

**Preconditions and range violations in the query.** The input domain asserts `int-bound` and `bmp`. The original's
`range-ok` and `ascii` are asserted through its status: the original must end with status 0 or a throw. The candidate
is **not** given that assumption: a candidate status of `VIOL_BASE + c` where the original returns or throws is a
different status, hence a difference. The candidate must not reach fuel (`rc.st != 1`). In SMT-LIB terms
(`checkEquivalent`):

```
pre    = (ro.st = 0 or 2 <= ro.st < 1000000) and rc.st != 1
differ = ro.st != rc.st or (ro.st = 0 and ro.v != rc.v)
```

## 4. The equivalence query and its coverage check

`checkEquivalent(original, candidate, bounds, budgetMs, z3)`:

1. Signature mismatch (parameter or return types) or any construct from `unsupportedConstructs`:
   `unsupported: <construct>`, before any encoding. An `Unsupported` raised during encoding (a sort key that can fail,
   a callback that is not inline, an unknown call): `unsupported` likewise. Nothing is approximated.
2. Encode both IRs over the same symbolic inputs. An encoding over the size budget (40,000,000 characters) is `unknown`
   ("did not complete"); a JavaScript stack overflow while unrolling is `unknown` with U named.
3. One solver call with two sections separated by `(reset)`: the query (`pre ∧ differ`) and the checked set alone
   (`pre`). Z3 `(error ...)` in the transcript is `unknown` with the text, never `unsat`; Z3 `unknown` is `unknown`; the
   driver's timeout is `timeout`.
4. `unsat` and the checked set empty: `unknown`, "vacuous", nothing claimed.
5. `unsat`, non-empty, and no activation reached U: `unsat`, coverage `full`.
6. `unsat`, and some activation reached U: the **coverage check** (`coverageCheck`). Excluded = the original reaches U,
   or the candidate reaches U while the original is inside the model. `box(m)` = every integer leaf (number parameters
   and number elements/fields below the length; not string code units, not booleans, not lengths) is in [-m, m].
   * One call: excluded ∧ box(0), excluded ∧ box(1), excluded, checked set ∧ box(1).
   * An excluded input with every integer in [-1, 1]: `unknown`, "size-driven", with that input as the example
     (`verifiedToK` then raises U). This [-1, 1] cutoff is policy (when narrowing is not worth it), not the soundness
     argument.
   * No excluded input at all: `unsat`, coverage `full`.
   * Otherwise the integer bound is narrowed: first the rung M - 1 below the largest |integer| M of Z3's excluded
     example, else powers of two below it, smallest first, three per call, stopping at the first rung that is not
     `unsat`. Each certified rung contains the smaller boxes, so the certified B' is sound even when it is not the
     largest. The checked set inside box(B') must be non-empty (else "vacuous"). The result is `unsat` with
     `bounds.int = B'`, coverage `int-driven` (or `unknown` when Z3 gave no example), and an `encodingNote` written for
     B' plus a sentence in capitals: "SOME INPUTS INSIDE THESE BOUNDS WERE EXCLUDED ... The claim above is therefore
     NARROWED to integers in [-B', B']".
   * Any Z3 unknown or timeout before a box is certified is `unknown`/`timeout`, never `unsat`.
7. `sat`: decode and replay (section 6).

## 5. Adaptive k: defaults and what was achieved

`verifiedToK` walks `DEFAULT_STEPS`, each step getting the remaining wall-clock budget:

| step | arrays | strings | integers | U |
|---|---|---|---|---|
| 1 | 2 | 2 | ±2^4 | 4 |
| 2 | 4 | 4 | ±2^8 | 6 |
| 3 | 6 | 6 | ±2^12 | 8 |
| 4 (the brief's defaults) | 6 | 8 | ±2^16 | 10 |

Rules: `unsat` continues to the next step; `sat`, `inconclusive` and `unsupported` end the run at that step; `timeout`
or `unknown` ends the run and the result is the last completed `unsat` step (or k = 0 with "No bound completed; nothing
is claimed"). A step answering `unknown` because inputs inside its bounds need more than U (size-driven, or vacuous with
fuel) is retried at the same bounds with U doubled, up to `MAX_UNROLL` = 64; later steps start at the largest U a
completed step needed. Every try is in `attempts`. A k that did not complete is never claimed; when a later step failed,
`SmtDetail.encoding` says which bounds did not complete and why. `SmtDetail.result` has no `unsupported` or
`inconclusive` member, so `verifiedToK` returns `detail: null` for those (the full result carries the reason).

### Measured (2026-10-05, system Z3 5.1.0, budget 60 s per pair)

Scratch script (not committed): `verifiedToK` with `DEFAULT_STEPS` for every in-subset corpus function (39) against
itself and against up to 3 engine mutants each (`generateMutants`, seed 7; 93 translatable mutants).

**Self pairs, 39 runs (57 s total):** 39 `unsat`, every one reaching the last step (arrays 6, strings 8, U = 10).
29 at the full requested integer bound ±65,536 with coverage `full`. 10 with the integer bound **narrowed** because a
loop or recursion driven by an integer needs more than 10 iterations beyond it:

| narrowed B' | functions |
|---|---|
| ±8 | numeric/aliquotSum, numeric/collatzSteps, numeric/factorial, numeric/fibRecursive |
| ±10 | numeric/fibonacci, string/repeatString, recursive/fibonacci |
| ±511 | recursive/powerBySquaring |
| ±512 | numeric/intPow |
| ±1023 | recursive/toBinary |

No step needed U above the step's default (no U doubling happened). Time per pair: median 117 ms, p90 4.3 s, max 34.9 s
(numeric/intPow). Self pairs have the same IR on both sides, so they measure which bounds are reachable rather than
typical query cost.

**Mutant pairs, 93 runs:** 89 `sat` at the first step (k = 2), every one replay-confirmed (0 `inconclusive`); 3 `unsat`
at the default bounds with full coverage; 1 `unknown`, k = 0 (numeric/intPow with a statement removed: Z3 answered
`unknown: timeout` on the first step within the 60 s budget, so nothing is claimed). The 3 `unsat` mutants were each
run against the original on 3,000 generated inputs (engine `generateInputs`, seed 11) with 0 differences: array/spread
`<` to `<=`, string/countChar `<` to `<=`, string/capitalize with a `return word;` removed. They look like equivalent
mutants; that is a test, not a proof that they are equivalent beyond the bounds. Mutant query time: median 22 ms, p90
79 ms, max 60.1 s (the budget).

So, measured: on this corpus the tool reaches the brief's sequence defaults (arrays 6, strings 8) at U = 10 for every
self pair it was given, and the brief's integer default ±2^16 for 29 of 39; for the other 10 the integer claim is
narrowed to between ±8 and ±1023, as reported in the result.

## 6. Counterexamples: decode and replay

On `sat`, `replaySat` decodes Z3's model into a `Val[]` input (`values.ts` `decode`: integers, BMP strings, arrays up to
their length, tuples, records, options) and runs **both** range-instrumented functions on it in the engine's sandbox
(`replay.ts` `runInstrumented`, `instrumentedSandboxSource`). The rule:

* either replay faults (`fault`): `inconclusive (encoder disagrees with execution)`; a sandbox fault is never a
  counterexample;
* the replayed original reports a range violation (the encoding placed the input inside the model, execution did not):
  `inconclusive (encoder disagrees with execution)`;
* the replayed outcomes are equal: `inconclusive (encoder disagrees with execution)`;
* otherwise `sat`.

A `sat` result's `counterexample.original` and `.candidate` are the **replayed** outcomes; `predicted` keeps what the
encoding said, for diagnosis only. A difference that only the encoder sees is never reported as a rejection. In the
measurements of section 5 (89 mutant `sat` results) no replay was `inconclusive`; the red-team tests that expect `sat`
require the replayed outcomes to differ, and they passed in this document's run.

## 7. Sanity mode and its corpus result

Sanity mode (`sanity.ts` `sanityCheck`, `sanityReport`) checks the encoding of each corpus function against execution:

* one encoding per function at capacities that fit every generated input (symbolic lengths, padding unconstrained),
  integers up to ±2^53;
* per input: `(reset)`, the encoding, `(assert input = constants)`, `(check-sat)`, `(get-value status+output)`;
  `(reset)` rather than `push`/`pop` because under `push`/`pop` Z3 skips the preprocessing that substitutes the
  constants (numeric/collatzSteps went from about 5 ms to over 60 s per input);
* a **uniqueness** pass: with the decoded output negated, the script must be `unsat`, so an encoding whose output
  depended on unconstrained padding cannot pass by luck;
* comparison with the range-instrumented original in the sandbox, including range-violation **details** (which checks
  the order of checks, not only their presence), and with the Lean checked twin `#eval` (`leanChkEvalExpr`) when Lean is
  available;
* inputs: engine `generateInputs`, seed 20261005, 60 per function, arrays <= 6, strings <= 8, integers mostly small plus
  ±2^53 boundaries; U starts at 24 and is lowered while the encoding exceeds 8 MB. Inputs where the encoder reached U
  ("fuel") or the TypeScript side faulted (500 ms timeout) are counted and not compared.

### Result, run for this document

```
export PATH=$HOME/.elan/bin:$PATH
pnpm exec vitest run packages/smt/src/sanity.test.ts
```

Started 2026-10-05T12:16:49Z; system Z3 5.1.0, Node v25.8.1, real Lean 4.34.0. 40 of 40 tests passed, 218 s.

| | count |
|---|---|
| in-subset corpus functions | 39 |
| encodable | 39 |
| inputs | 2,340 |
| compared with the instrumented original | 2,246 (2,246 agreements) |
| compared with the Lean checked twin | 2,246 (0 differences) |
| uniqueness checks (all `unsat`) | 2,340 |
| not compared: encoder reached U (fuel) | 82 |
| not compared: TypeScript side faulted (timeout) | 12 |
| solver did not answer | 0 |
| **mismatches** | **0** |

Fuel inputs by function: numeric/fibRecursive 17, recursive/fibonacci 17, numeric/fibonacci 12, string/repeatString
10, numeric/aliquotSum 7, recursive/powerBySquaring 7, recursive/toBinary 7, numeric/collatzSteps 5. U was lowered to 10
for numeric/fibRecursive and recursive/fibonacci and to 16 for string/repeatString (encoding size). Slowest functions:
string/repeatString 81 s (5.7 MB encoding), recursive/fibonacci 27 s, numeric/fibRecursive 25 s, string/toCsvRow 20 s;
most others 1 to 3 s. Compared outcomes include returns, throws and range violations (for example numeric/factorial:
15 ok, 31 throw, 14 range-violation).

(NOTES.md records an earlier run the same day with 2,244 compared and 84 fuel. We did not establish which
encoder change between the two runs moved two inputs from fuel to compared (the round-2 change to count fuel in
iterations is a candidate); both runs had 0 mismatches. The figures in the table are from this run.)

`library.test.ts` (17 purpose-built functions for operations the corpus does not exercise: `intToStr`/`boolToStr` in
templates, symbolic split separators, string comparisons and sorts, index callbacks, string `indexOf`, `join` of
numbers and booleans, negative slice indices, `charCodeAt`, case maps, ceil division, options, tuples, recursion) passed
in this document's run (section 9). NOTES.md records that the harness is not vacuous: replacing `tmod` with plain `mod`,
or swapping the separator order in `join`, made the library sanity tests fail (checked by hand, then reverted; not
repeated for this document).

## 8. Unsupported constructs (a finding)

`unsupportedConstructs` (`encode.ts`) walks every function body before any encoding, so a construct behind a dead or
fuel-exhausted branch is still reported. It can report:

* `primitive <op>` for an IR primitive outside `SUPPORTED_PRIMS` (today `SUPPORTED_PRIMS` is every `PrimOp` in
  `translate/src/ir.ts`);
* `sortBy without a recognized comparator`;
* `<op> without an inline callback` (map/mapI/filter/filterI/foldl/foldlI);
* `a callback outside map/filter/reduce/sort`;
* `call of an unknown function <name>`;
* `Math.min()` / `Math.max()` with no arguments.

The encoder can also raise `Unsupported` while encoding: `a sort key that can fail`, `a callback that is not an inline
function`. A parameter or return type mismatch between original and candidate is `unsupported` too. Each is reported
as `unsupported: <construct>`; none is approximated.

**Finding: 39 of 39 in-subset corpus functions are fully encodable; the list of unsupported constructs over the corpus
is empty** (sanity run above, "39 encodable"; `sanityReport` collects the per-construct list). Every primitive the
translator emits is encodable; the pre-pass guards against structural impossibilities the translator does not produce
today.

## 9. Z3 drivers: WASM in Node, system fallback, timings

`openZ3()` (`z3.ts`) tries WASM first, then a system `z3`; which one ran is recorded in every result (`z3: {kind,
version}`).

* **WASM** (`z3-solver` 5.2.0): runs in Node. Each query runs in a fresh `worker_threads` worker that calls
  `eval_smtlib2_string`; on budget expiry the worker is terminated (Z3's own timeout is not relied on in WASM). A probe
  query at open time makes a broken WASM load fall back instead of failing at first use.
* **System** (Z3 5.1.0 here, or `FAITHFUL_Z3_BIN`): `z3 -in -smt2 -T:<seconds>` (rounded up) plus a process-group kill
  2 s after the budget.

Test suite run for this document:

```
pnpm exec vitest run packages/smt --exclude '**/sanity.test.ts'
```

Started 2026-10-05T12:26:10Z: 9 test files, 726 tests, all passed, 264 s wall (intsem 4, coverage 7, z3 5, library 17,
coverage-r2 9, equivalence 36, redteam-strings-decode 198, redteam-arith-control 290, redteam-arrays 160).
`z3.test.ts` checks both drivers solve sat/unsat with a model and enforce the wall-clock budget, and that `openZ3`
prefers WASM. The budget test in `equivalence.test.ts` (a^3 + b^3 = c^3 vs `0`) returns `timeout` within the budget on
both drivers.

Per-query times from `equivalence.test.ts` in that run, at the default bounds (arrays 6, strings 8, integers ±2^16,
U = 10), total time including replay. Test files ran in parallel (about 3 cores busy), so these are under load:

| pair | system Z3 5.1.0 | WASM Z3 5.2.0 |
|---|---|---|
| 8 known-different pairs (off-by-one, wrong comparison, missing case, overflow-only, empty array, thrown message, string case, sort direction) | 19-33 ms each | 234-383 ms each |
| sum via loop vs reduce | 16 ms | 241 ms |
| floor division and remainder recombine | 55 ms | 402 ms |
| count via filter vs loop | 152 ms | 623 ms |
| string reverse, loop vs recursion | 212 ms | 1,002 ms |
| (a+b)^2 vs a^2+2ab+b^2 (nonlinear) | 733 ms | 2,194 ms |
| iterative vs recursive fib (1.56 MB encoding, narrowed to ±10) | 5,702 ms | 34,837 ms |

WASM costs about 200-350 ms more per query on small queries in this run (worker start and WASM instantiation; NOTES.md measured
130-150 ms on an idle machine) and is 3 to 6 times slower on hard ones. The corpus sanity run uses the system driver
because it sends many large scripts.

## 10. Red-team history

Three red-team rounds probed the tier in three areas: arith-control (integer semantics, range checks, unrolled loops
and fuel, recursion, early exits, throws, options, candidate violations), arrays, and strings-decode (string encoding,
counterexample decoding, replay fidelity). Probes and harnesses live in `packages/smt/redteam/<area>/` and
`packages/smt/src/redteam-<area>.test.ts`. Every probe's expectation is the correct behaviour with sandbox ground truth
(brute force over the bounds where feasible); a finding stays a failing test until fixed, never weakened.

The figures below were supplied with this task as three unlabeled entries per round. The area for each column is our
matching against the test headers: **arrays** is confirmed by its header in every round (57/55, 55/54, 45/45), and
**arith-control** round 2 (61 probes) is confirmed by its header; the other assignments are inferred from those.
Every area cell is "probes / held / bugs". "Bugs" counts distinct defects; one defect can fail several probes, so
probes minus held can exceed bugs.

| round | arith-control | arrays | strings-decode | total probes | bugs |
|---|---|---|---|---|---|
| 1 | 73 / 69 / 3 | 57 / 55 / 2 | 89 / 84 / 2 | 219 | 7 |
| 2 | 61 / 56 / 2 | 55 / 54 / 1 | 50 / 50 / 0 | 166 | 3 |
| 3 | 305 / 305 / 0 | 45 / 45 / 0 | 58 / 58 / 0 | 408 | 0 |

What the findings were (from the test headers and NOTES.md):

* **Round 1.** V1 (arith-control): `unsat` over an empty checked set: a pair that differs on every input (a fixed
  12-step loop at U <= 10, or an original that overflows on every input) was reported "Verified to k". The
  strings-decode area found the same defect class (a loop whose trip count is at least 20 or a 26-letter alphabet
  loop). Fixed by the non-emptiness section and the coverage check. V2 (arith-control): a documentation claim in NOTES
  that doubly recursive fib encodes quadratically in U was false (it is exponential); the claim was corrected, the
  growth itself is an open limit (section 11). V3 (arith-control): a JavaScript stack overflow during deep unrolling
  escaped `checkEquivalent`; now reported as `unknown`. Arrays: `fuelConcatIndexLoopDiffer` and
  `fuelSquareIndexLoopDiffer` answered "Verified to k = 6" with a distinguishing input inside the bounds, because
  inputs needing more than U iterations were asserted away. Fixed by the coverage check. The second strings-decode
  round-1 bug is not itemized separately in the sources read for this document.
* **Round 2.** R2-V4 (arith-control): the round-1 coverage rule ("no excluded input has every integer 0") classified a
  size-driven exclusion as integer-driven when a guard kept the all-zero input away from the loop, and "Verified to 6"
  was reported although the pair differs on a one-element array. R2-L1 (arith-control): a loop of exactly U iterations
  was excluded while the note said "within U iterations". Arrays: `r2MergeCapIntGatedDiffer` (a two-pointer merge that
  is short when every element is 0) hit the same misclassification as R2-V4. Fixed by replacing classification with
  integer-bound narrowing (section 4) and by counting fuel in iterations.
* **Round 3.** No new finding. arith-control includes a mutation fuzz (`fuzz-r3.mjs`, 195 probes, plus the encoder on
  400 concrete inputs per function) and a universal assertion that every `unsat` has no ground-truth difference inside
  the box it reports; arrays and strings-decode added families such as sort key paths, join equality, decoding of
  nested records and `Option<tuple>`, and loops driven by strings inside records and tuples.

**Unresolved soundness findings: none.** Every red-team probe of every round passes in this document's run (section 9:
the three red-team files, 648 tests, all passed). This covers the probes listed; it is not evidence that a further round
would find nothing.

## 11. Known limits and open issues

These are not unresolved red-team findings; they are limits of the design or of this build.

* **Not wired into the CLI** (section 1): no session reaches "Verified to k" in this build.
* **The note's wording of U for recursion is off by one.** `Encoder.inline` gives the recursive main function at most
  U activations (depth > U is fuel), i.e. the top-level call plus U - 1 nested self-calls, while `encodingNote` says
  "U nested calls of a recursive function". This is the same shape as R2-L1 for loops (fixed there). It does not make
  an `unsat` unsound: every input that reaches fuel sets `fuelUsed` and goes through the coverage check, so the
  reported bounds stay exact. It is a label-precision defect in the note text; fixing it means changing either the
  limit or the wording in `equivalence.ts` / `encode.ts` (not done for this document).
* **Exponential encodings.** Doubly recursive integer functions and loops with `continue` grow exponentially in U
  (measured by the red team for test-suite fib: 21,014 characters at U = 4, 1,558,284 at U = 10, 26,303,471 at
  U = 14). Above the 40,000,000-character budget the answer is `unknown` ("did not complete"), never a claim. Not fixed.
* **String-building loops** (string/repeatString) grow with string capacity per iteration: slow in sanity mode (81 s)
  and, against a mutant, potentially past the budget. Reported as `unknown`/`timeout`, never a claim.
* **Hard arithmetic can time out**: numeric/intPow against one mutant answered `unknown` (timeout) at the first step
  within 60 s, so k = 0 and nothing is claimed.
* **`SmtDetail` has no `unsupported` or `inconclusive` result**; `verifiedToK` returns `detail: null` for them. The
  session owner should add the two members (`packages/session/src/details.ts`).
* **`SmtDetail.k` is a single number** (min of the array and string bounds) and is unchanged by integer narrowing; a
  consumer that prints only k and not `bounds` would overstate. The bounds are always in the detail.
* **B' is certified, not maximal**: when Z3's excluded example is not the smallest excluded magnitude, B' is the
  largest certified power of two below it (an under-claim).
* **The [-1, 1] size-driven cutoff is policy**: a pair that guards |n| <= 1 can get a true but weak claim at ±1,
  visibly labelled.
* **Deep U** (hundreds) can exhaust the JavaScript stack while encoding (reported as `unknown`), so the depth-500 check
  is not reachable through `checkEquivalent` on a default stack. NOTES.md records that the red team confirmed its
  encoding with `node --stack-size=60000`.
* **Sanity mode compares only inputs where the encoder finished**: 82 fuel inputs and 12 TypeScript timeouts were
  counted, not compared, in this run.
* **Measurements of adaptive k** in section 5 come from a scratch script over the corpus (39 functions, 93 mutants),
  not from a committed benchmark.
