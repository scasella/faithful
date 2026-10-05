# Proofs: how they are generated, how they are checked, and how often they succeed

Date of every number below: 2026-10-05. Model `gpt-6-luna` through Codex CLI 0.159.2, Lean 4.34.0, Mathlib
`5ed2965256430c3649e86755f9576b54eca72435`, macOS arm64. Raw results: `docs/measurements/2026-10-05-proofs-*/`
(`results.jsonl` plus every session's `events.jsonl` / `session.json`, which hold every prompt and response verbatim).
Summaries were produced with `node scripts/proof-summary.mjs <dir> [--only ids]`.

A proof here is always a proof about the **Lean model** of a function (docs/TRANSLATOR.md) and the agreed spec; see
"Limits" and docs/TIERS.md.

## How a proof is generated

`proveTheorem` (`packages/prover/src/prove.ts`) runs a loop: ask Codex for an attempt, check it with Lean ourselves,
feed the diagnostics back, stop on success or when the attempt or wall-clock budget runs out. Codex runs read-only in an
empty temp directory and never runs Lean; it returns JSON `{helpers, proof, reasoning}`. `helpers` are lemmas/defs placed
before the theorem, `proof` is the text after `:=`. The statement is ours (`originalMeetsSpec`,
`packages/cli/src/flow/theorem.ts`):

```
∀ args, Model.<f>_pre args = true → <no-throw / carve-out hypotheses> = true → Model.<f> args = Spec.spec args
```

**Effort policy.** Each attempt's reasoning effort comes from a policy list; attempt n uses entry `min(n, length)`, the
last entry repeats (`effortFor`). The policy is `FAITHFUL_PROOF_EFFORT` (comma list such as `low,medium,high`) when set,
otherwise `FAITHFUL_EFFORT` for every attempt when set, otherwise the default `DEFAULT_PROOF_EFFORT` = **`high` on every attempt**. Note that a set `FAITHFUL_EFFORT` (for
example `FAITHFUL_EFFORT=low`) therefore also lowers proof attempts unless `FAITHFUL_PROOF_EFFORT` is set. Spec
proposals, revisions and optimization candidates keep using `FAITHFUL_EFFORT` (default `low`). The effort actually used is
recorded on every call (`CodexCall.effort`, the `-c model_reasoning_effort=` argument, and `CallRecord.effort` in the
session log).

## How a proof is checked (never weakened by this work)

`checkProof` (`packages/prover/src/proofFile.ts`), for every attempt:

1. **Vetting** (`vetProofText`), on the text with comments stripped: refused if it contains `sorry`, `admit`, `axiom`,
   `opaque`, `unsafe`, `implemented_by`/`extern`/`csimp`, syntax extensions (`macro`, `syntax`, `notation`, `elab`,
   `infix`, ...), `open`/`namespace`/`section`/`end`/`variable`/`universe`/`import`/`mutual` at a line start, `#` commands,
   `set_option` other than `maxHeartbeats`/`maxRecDepth`/`linter.*`, a redefinition of a `Faithful.*` name, or an instance.
2. **Assembly** (`buildProofFile`): imports (`Faithful.Tactics`, which now also imports `Faithful.Simp`), the
   translator's model, the agreed spec, the helpers, then `theorem original_meets_spec : <statement> :=` and the proof.
3. **Compilation** with `lean --json` under a wall-clock budget (180 s per attempt, process group killed on timeout).
4. **Statement fingerprint**: `#check @original_meets_spec` must print exactly what the same file prints with the proof
   replaced by `sorry` (cached per target). Anything else is `statement-changed`.
5. **Axioms**: `#print axioms`; only `propext`, `Classical.choice`, `Quot.sound` give Proved; `native_decide`'s axiom gives
   Proved (trusting the compiler); anything else (including `sorryAx`) is not a proof.

`Faithful.Simp` (new) adds only theorems, each proved in `lean/Faithful/Simp.lean` from the definitions in
`Faithful.Core` (`lake build` checks them; `#print axioms` on each lists at most `propext`, `Quot.sound`). A `@[simp]`
attribute changes what `simp` tries, not what any statement means; the fingerprint and axiom checks are unchanged. Models
and spec evaluation still import only `Faithful.Core`.

## The proof prompt

Unchanged parts: the complete file with `<YOUR PROOF GOES HERE>`, the runtime library source (read-only), the JSON
contract, the `sorry`/`native_decide` rules, and the last three failed attempts with their verdicts and Lean
diagnostics (with goal states).

Added (lever c, on by default; `FAITHFUL_PROOF_GUIDE=0` turns it off):

* `PROOF_GUIDE` (prove.ts): how the model is shaped (`Model.f` + one recursive `Model.f_loopN` per loop, returning the
  state tuple), and Lean 4.34 patterns that were each compiled against emitted models before being written down:
  `rw [Model.f_loopN]` unfolds one step, `simp [Model.f_loopN]` on a well-founded definition loops ("maximum recursion
  depth", 17 of 66 baseline TUNE attempts); state the loop invariant for arbitrary state and prove it with
  `fun_induction` (with how its case binders are counted) or a Nat measure; accumulator lemmas for spec helpers; the
  throwing branch closes by `rfl`; what `omega` does and does not understand (`Int.fdiv`/`Int.tmod` no; exact core lemma
  names `Int.fdiv_eq_ediv_of_nonneg`, `Int.tmod_eq_emod_of_nonneg`); `simp` turning `↑x.natAbs` into `|x|`; a short list of
  List lemma names that exist in this toolchain; never `sorry` (an attempt with `sorry` is rejected with no feedback; 18 of 66 baseline TUNE
  attempts).
* **Induction principles**: before the first attempt the prover compiles the file once with `#check @F.induct` for every
  recursive function of the model and the spec (`inductionPrinciples`) and shows Lean's output. These are facts from
  Lean, not advice; `fun_induction` case names must be counted from them.
* **Located diagnostics**: each error of a previous attempt is labelled with the line of the attempt's own text it
  came from (`your proof, line 7: \`simp [h]\``), since the model only sees the file with a placeholder. At most 4 errors,
  each truncated at 3,000 characters.
* The line "`simp [Model.pre]` unfolds it" (wrong name, and unfolding the precondition reaches the recursive `_chk`
  twin) is replaced by a correct one.

The library block now also lists `Faithful.Simp`, so the model can cite those lemma names.

## Tuning experiment

### The split (fixed in advance)

Written down before any tuning run and before any held-out failure was read:

* Population: every corpus function with `inSubset: true` in the baseline results
  (`docs/measurements/2026-10-05-proofs-low/results.jsonl`). The translator is deterministic, so this equals "not refused".
  When the rule was written the baseline run was still finishing its last three string functions; the translator accepts
  all three, so the population is **39** functions (the brief estimated 37).
* Order: ids (`class/fn`) sorted lexicographically.
* TUNE = 0-based index i with i mod 3 = 1; HELD-OUT = the rest. **13 TUNE, 26 HELD-OUT.**
  TUNE: array/dedupe, array/maxWindowSum, array/reverseArray, array/sum, numeric/aliquotSum, numeric/digitSum,
  numeric/fibonacci, numeric/sign, recursive/powerBySquaring, refuse/prefixSumUntilNegative, string/countChar,
  string/longestRun, string/toCsvRow. (`refuse/prefixSumUntilNegative` lives in the corpus's `refuse` folder but is in the
  subset; it is reported as its own class.)
* Consequences recorded up front, not adjusted: the two baseline proofs `array/sum` and `numeric/sign` fall in TUNE, so
  the held-out baseline is 1 proof (`array/sortPointsByY`). The functions blocked at agreement in the baseline are all
  held-out and stay in the denominator: `array/sumOddSquares`, `string/caesarShift`, `string/ellipsize`, and
  `string/repeatString` (which finished after the rule was written).
* Protocol: greedy forward selection in the order (a) effort, (c) prompt, (d) simp lemmas, (f) spec prompt,
  (b) attempts/time; each lever measured on TUNE as the change over the current stack and dropped if it does not help.
  (e) emission changes only if (d) left `pure`/`throw` residue unsolved.

### Budget and default per lever

Every TUNE run used the real workflow (`node scripts/measure.mjs --corpus --no-optimize --concurrency 3 --only <13 ids>`:
translate, spec proposal at effort `low`, challenge search, the autopilot's rulings, agree, prove the original). The spec
is proposed afresh in every run, so runs differ in the spec as well as in the proof attempts. Baseline budget: 6 attempts,
6 minutes per proof. Two runs were usually executed at the same time (6 sessions), so wall times below are inflated
relative to a quiet machine; the held-out run ran alone.

### TUNE results (13 functions)

Columns: proved / in-subset overall and per class (numeric 4, array 4, string 3, recursive 1, refuse-folder 1), functions
blocked at agreement (no proof attempted), median attempts and proof-loop minutes of the proved ones, all Codex calls,
summed proof-loop minutes, summed session wall minutes, tokens (input incl. cached / output), and how many of the proofs
were found within 6 attempts and 6 minutes.

| run (`docs/measurements/2026-10-05-proofs-<run>`) | proved | num | arr | str | rec | ref | blocked | med. att | med. min | calls | proof min | wall min | tokens in / out | within 6x6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline: `low` (TUNE rows of the baseline run) | 2/13 | 1/4 | 1/4 | 0/3 | 0/1 | 0/1 | 0 | 1 | 0.1 | 83 | 17 | 24 | 1.91M / 36k | 2 |
| baseline replicate `tune-base-r2` | 3/13 | 1/4 | 2/4 | 0/3 | 0/1 | 0/1 | 0 | 1 | 0.3 | 83 | 18 | 25 | 1.97M / 36k | 3 |
| (a) `medium` `tune-a-medium` | 5/13 | 2/4 | 2/4 | 0/3 | 0/1 | 1/1 | 1 | 2 | 0.4 | 70 | 18 | 35 | 1.57M / 48k | 5 |
| (a) `low,medium,high` `tune-a-esc` | 4/13 | 2/4 | 1/4 | 0/3 | 0/1 | 1/1 | 1 | 2 | 0.7 | 79 | 46 | 55 | 1.71M / 135k | 4 |
| (a) `high` `tune-a-high` | 7/13 | 4/4 | 2/4 | 0/3 | 0/1 | 1/1 | 0 | 1 | 0.5 | 72 | 49 | 84 | 1.51M / 143k | 7 |
| (a) `high`, replicate `tune-a-high-r2` | 5/13 | 2/4 | 2/4 | 0/3 | 0/1 | 1/1 | 1 | 3 | 1.8 | 71 | 51 | 61 | 1.50M / 143k | 5 |
| (c) high + guide `tune-c-guide` | 6/13 | 3/4 | 2/4 | 0/3 | 0/1 | 1/1 | 0 | 1.5 | 0.6 | 77 | 50 | 90 | 1.73M / 149k | 6 |
| (d) high + simp, no guide `tune-d-simp-noguide` | 6/13 | 3/4 | 2/4 | 0/3 | 0/1 | 1/1 | 0 | 1 | 0.6 | 71 | 51 | 68 | 1.58M / 145k | 6 |
| (d) high + guide + simp `tune-d-simp` | 8/13 | 4/4 | 3/4 | 0/3 | 0/1 | 1/1 | 0 | 3.5 | 2.3 | 67 | 46 | 69 | 1.59M / 129k | 8 |
| (d) same, replicate `tune-d-simp-r2` | 7/13 | 3/4 | 2/4 | 0/3 | 1/1 | 1/1 | 0 | 2 | 1.8 | 73 | 45 | 56 | 1.68M / 131k | 7 |
| (f) + spec shape hint `tune-f-spechint` | 7/13 | 2/4 | 3/4 | 1/3 | 0/1 | 1/1 | 0 | 3 | 2.2 | 73 | 50 | 60 | 1.78M / 141k | 7 |
| (b) high + guide + simp, 10 attempts / 12 min `tune-b-10x12` | 8/13 | 2/4 | 3/4 | 1/3 | 1/1 | 1/1 | 0 | 2 | 1.7 | 94 | 77 | 95 | 2.48M / 216k | 6 |

Run-to-run noise on 13 functions is large: the same configuration gave 2 and 3 (low), 7 and 5 (high), 8 and 7
(high + guide + simp). A difference of one or two functions between single runs is not evidence.

### What each lever did, and what was chosen

* **(a) Effort: adopted, `high` on every attempt.** The only lever whose effect is clearly larger than the noise:
  low 2-3, medium 5, high 5-7. The escalation policy `low,medium,high` (4) was no better than medium and worse than
  uniform high: the cheap first attempts mostly produced `sorry` placeholders or shallow `simp` calls and used up time.
  At low effort the typical attempt took 7-20 s; of the 66 baseline TUNE attempts, 18 were rejected for containing
  `sorry` (no Lean feedback at all) and 17 failed with `simp` looping on a recursive definition ("maximum recursion
  depth"). At high effort `sorry` almost disappears (1 and 6 of 47 attempts) and an attempt takes 30-95 s, so the
  6-minute budget becomes binding.
* **(c) Prompt guide + induction principles + located diagnostics: kept, but not on its own evidence.** high + guide
  gave 6 against high's 7 and 5.
* **(d) `Faithful.Simp` (lemmas + their listing in the prompt): kept, but not on its own evidence.** high + simp
  without the guide gave 6. The combination high + guide + simp gave 8 and 7 (mean 7.5) against high's 7 and 5 (mean 6).
  **Protocol deviation:** under the greedy rule written in advance ("drop if it does not help"), (c) alone would have
  been dropped before (d) was tried; (d) was instead run on top of (c) in parallel with (c), and the pair was kept
  because the combined stack had the best two-replicate mean. That is a judgment on noisy data (difference 1.5 functions
  on 13), not a measured effect of either lever. Supporting observations, also weak: looping-`simp` errors fell from
  3 and 9 attempts (high alone) to 2 and 0 (the stack, 6-attempt runs); four TUNE functions were proved in some runs with
  guide + simp and in no run without it (`array/maxWindowSum`, using `Faithful.slice_of_nonneg`; `array/reverseArray`;
  `recursive/powerBySquaring`; `string/countChar`), but there were four such runs against two high-only runs.
* **(e) Translator emission: not attempted.** With `Faithful.Simp`, `simp` rewrites `pure`/`throw` into
  `Except.ok`/`Except.error` and `Except.ok a = Except.ok b` into `a = b`; no residue of that kind appeared in the
  diagnostics of the (d) runs, so a translator change (and its 2,300-test differential suite) was not justified.
* **(f) Spec shape hint: tried, not adopted** (7 against 8). The text was: "Among equally clear formulations, prefer the
  one that is easiest to reason about: structural recursion on a List or on a Nat (`n.toNat`), `List.foldl`/`List.map`/
  `List.filter`/`List.range`, and Int arithmetic throughout (do not move to Nat except to drive a recursion). Avoid helper
  functions with accumulator arguments when a direct recursion says the same thing, and avoid well-founded recursion
  (`termination_by`). Never trade clarity or correctness for this." It touches what the user is asked to agree to and
  did not help measurably, so the spec prompt is byte-identical to the baseline.
* **(b) Budget: adopted, 10 attempts / 12 minutes per proof** (was 6 / 6 in measure.mjs, 6 / 10 in the CLI and the
  local API default). With high effort, 4 of the 5 failures in `tune-d-simp` ended with a Codex call cut off by the
  6-minute budget; in `tune-b-10x12`, 2 of the 8 proofs came at attempts 7 and 9 (`recursive/powerBySquaring` 7.2 min,
  `string/countChar` 9.6 min). Inside that same run, 6 proofs were found within 6 attempts and 6 minutes, so of its 8,
  2 are attributable to the larger budget. Cost: proof-loop minutes on TUNE went from about 46 to 77, Codex calls from
  about 70 to 94. The UI's own default budget (3 attempts / 5 minutes, `apps/ui/src/screens/prove/proveModel.ts`) is a
  user choice in the Prove screen and was not changed.

Final configuration (the code defaults): proof attempts at effort `high`, guide on, `Faithful.Simp` imported by
`Faithful.Tactics` and listed in the prompt, spec prompt unchanged, budget 10 attempts / 12 minutes in `measure.mjs`, the
CLI (`faithful optimize --proof-attempts/--proof-minutes`) and the local API default.

## Held-out evaluation (run once, with the shipped defaults)

`node scripts/measure.mjs --corpus --no-optimize --concurrency 3 --only <26 held-out ids>` with no `FAITHFUL_*`
environment variables, i.e. exactly the code defaults (proof effort `high`, guide on, `Faithful.Simp`, 10 attempts /
12 minutes), nothing else running on the machine. Output: `docs/measurements/2026-10-05-proofs-final-heldout/`. The
baseline numbers are the held-out rows of `docs/measurements/2026-10-05-proofs-low/` (effort `low`, 6 attempts / 6 min),
which already existed for all 39 functions; the baseline was not re-run.

| class | baseline proved | final proved | final, within 6 attempts and 6 min | blocked at agreement (baseline / final) | final: median attempts / minutes of proved |
|---|---|---|---|---|---|
| numeric | 0/6 | 3/6 | 2 | 0 / 0 | 1 / 1.1 |
| array | 1/9 | 4/9 | 3 | 1 / 1 | 3 / 2.1 |
| string | 0/7 | 2/7 | 0 | 3 / 3 | 9 / 8.3 |
| recursive | 0/4 | 3/4 | 2 | 0 / 0 | 5 / 5.0 |
| **total** | **1/26** | **12/26** | **7** | 4 / 4 | 5 / 4.4 |

Proved in the final run: array/flattenPairs, array/sortPointsByY, array/spread, array/prefixSums, numeric/clamp,
numeric/collatzSteps, numeric/fibRecursive, recursive/fibonacci, recursive/toBinary, recursive/flattenPairs,
string/capitalize, string/reverseString. Baseline: array/sortPointsByY only.

The same four functions were blocked at agreement in both runs (array/sumOddSquares, string/caesarShift,
string/ellipsize, string/repeatString): the autopilot's two "the spec is wrong" revisions did not converge and no carve-out
class was offered. No proof was attempted for them; they count as not proved. Of the 22 functions that reached the proof
stage, 12 were proved (baseline: 1 of 22).

Budget-matched view: the same run contains the 6-attempt / 6-minute loop as a prefix, so 7 of the 12 proofs would have
been found under the baseline budget; the other 5 needed attempts 7-10 or more than 6 minutes (prefixSums 10 attempts
11.4 min, collatzSteps 9 / 10.4, recursive/flattenPairs 8 / 6.4, capitalize 8 / 6.7, reverseString 10 / 9.9). So of the
improvement from 1 to 12, about 6 functions come from effort + prompt + simp lemmas at the old budget and about 5 from the
larger budget.

Cost, held-out (26 functions): Codex calls 198 final vs 175 baseline (157 proof attempts at `high` vs 132 at `low`);
tokens 6.52M input (most of it cached Codex overhead, about 19k per call) / 0.46M output vs 4.22M / 0.07M; summed
proof-loop time 169 min vs 31 min; summed session wall time 227 min vs 83 min (at concurrency 3 the run took 1 h 33 min of
clock time; one function, string/repeatString, spent 39 min in the challenge search before blocking at agreement, as it
did in the baseline). A proved function's proof took a median 5 attempts and 4.4 minutes; a function that is not proved costs
the whole budget (10 attempts or 12 minutes, typically 10-13 minutes).

The improvement held up on functions it was not tuned on (TUNE: 2-3 of 13 at baseline, 7-8 of 13 at the final stack; held-out:
1 of 26 to 12 of 26). It is still fewer than half of the in-subset functions.

## What still fails, and why (held-out, read after the run)

Each of the 10 held-out failures ran out of attempts (7) or time (3). Dominant error per attempt, over all their attempts:
`unsolved goals` 44, `omega` counterexample 30, looping `simp` 7, unknown lemma name 6, other compile errors 5. No attempt
contained `sorry`, and no `pure`/`throw` residue appeared. By cause:

* **Invariant too weak or not generalized** (array/maxSubarraySum, array/countOccurrences, array/twoSum,
  numeric/intPow, numeric/factorial): the model writes a loop lemma whose statement is false or not inductive
  (wrong state relation, invariant missing a bound), then fights the resulting goals. twoSum has two nested loops with
  an early `return` (`Faithful.Flow.ret`); intPow halves the exponent with `Int.fdiv`/`Int.tmod` inside a `have` chain.
* **Arithmetic the model cannot close** (numeric/floorDivMod: `Int.fdiv`/`Int.tmod` with a negative divisor, outside
  what the `Faithful.Simp` normal forms cover; string/trimControl: `Faithful.charCodeAt` bounds; array/countOccurrences:
  character code ranges): `omega` counterexamples repeated across attempts.
* **The spec's shape** (recursive/reverseDigits: the agreed spec is an imperative `Id.run do ... while ...` loop, so
  the goal contains the `forIn`/`Loop` encoding, for which neither the guide nor the library offers lemmas;
  array/medianFloor: model and spec both sort with `List.mergeSort`, but with differently written comparators, and
  relating the two needs facts about `mergeSort` that are not in the tactic set).
* **List/String library gaps**: string/countVowels failed on `List.getD`/indexing side conditions.

The TUNE functions that were never proved in any run, `string/longestRun` (five-component loop state with a run
counter) and `string/toCsvRow` (`Faithful.split`/`join`/`strIndexOf`), are of the same kinds.

## Limits

* Every "Proved" is about the Lean model produced by the translator and the agreed spec, under the stated
  preconditions; the link to the TypeScript is the translator's design and the test on N inputs that accompanies the
  claim (docs/TIERS.md). Proof success rates say nothing about whether the spec is the one the user wanted.
* The measurements use the autopilot user policy (docs `packages/cli/src/flow/autopilot.ts`); a real user who rules
  differently gets different specs and different proof difficulty.
* 13 TUNE functions with a freshly proposed spec in every run give a noise of about +-2 functions between runs of the same
  configuration; individual lever effects other than effort are not established by these data.
* `Faithful.Simp` makes `simp` stronger in every proof file. Proofs written against the old `Faithful.Tactics` can stop
  compiling: re-checking the 20 proofs accepted in earlier runs (baseline and the effort-only runs) under the new
  library, 19 still check and 1 (numeric/fibonacci from `tune-a-high`) fails with "No goals to be solved" because `simp`
  now closes the goal one step earlier. `faithful verify` recompiles a delivered `.lean` file against the current
  library, so a delivery made before this change can fail that check after it.
* Effort `high` makes each attempt slower (30-95 s instead of 7-20 s) and the budget 10 attempts / 12 minutes means a
  failing proof now costs about 12 minutes instead of 1-2.

## Reproducing

```
node scripts/measure.mjs --corpus --no-optimize --concurrency 3 --out <dir> --only <ids>          # defaults = final config
FAITHFUL_PROOF_EFFORT=low FAITHFUL_PROOF_GUIDE=0 node scripts/measure.mjs ... --proof-attempts 6 --proof-minutes 6
                                                     # baseline prompt and effort (the Faithful.Simp import cannot be turned off)
node scripts/proof-summary.mjs <dir> [--only ids] [--within 6,6]
```

