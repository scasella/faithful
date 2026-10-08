# Tiers: what each label means and what it does not

Every claim Faithful makes carries exactly one of five labels, defined in `packages/core/src/tiers.ts`. This document
states what each label means, what it does not mean, which evidence produces it, and how it can be wrong. It describes
the code as of 2026-10-05 (Node v25.8.1, Lean 4.34.0, Mathlib `5ed2965256430c3649e86755f9576b54eca72435`). Where this
document and the code differ, the code is what runs and this document is wrong.

Labels are words, never numbers: Faithful has no ranking or marking of results. In user-facing text the per-hundred
sign appears only inside "95% CI" (a confidence interval of a benchmark ratio). `lintEvidenceText` in
`packages/engine/src/evidence/evidence.ts` rejects that sign anywhere else, a fixed list of ranking words, and the phrase
that claims a result holds on every possible input of the TypeScript function. Faithful never says that about
TypeScript.

## The five labels

`TIER_ORDER`, strongest first:

| Tier id | Label (`TIER_LABEL`) |
|---|---|
| `proved` | Proved |
| `proved-trusting-compiler` | Proved (trusting the compiler) |
| `verified-to-k` | Verified to k (shown as `Verified to k=6` with the actual bound) |
| `tested` | Tested |
| `not-proved` | Not proved |

`weakerOf(a, b)` returns the later of the two in this order. `Not proved` is the absence of a claim, not a fifth kind of
evidence.

### Proved

**Means.** Lean 4.34.0 accepted a theorem whose statement Faithful wrote (the model never writes or edits it), the
theorem's elaborated type is identical to the type of the same statement elaborated with a `sorry` proof, and
`#print axioms` lists only axioms from `propext`, `Classical.choice`, `Quot.sound` (an empty list also counts). The
theorem is about the **Lean model** of the function, produced by the fixed translator (`packages/translate`,
docs/TRANSLATOR.md), and about the agreed spec. Two statements are proved in the product:

* Original (`original_meets_spec`, built by `originalMeetsSpec` in `packages/cli/src/flow/theorem.ts`):
  `∀ args, Model.<fn>_pre args = true → <each extra hypothesis> = true → Model.<fn> args = Spec.spec args`.
  The extra hypotheses are the `no-throw` precondition (only when the user chose "treat the throw as a precondition")
  and every carve-out.
* Optimized candidate (`candidate_<id>_meets_spec`, built in `Optimizer.proveCandidate`,
  `packages/cli/src/flow/optimize.ts`): under the original's `pre` and the same extra hypotheses,
  `Model.<fn>_cand_pre args = true ∧ Model.<fn>_cand args = Spec.spec args`. The first conjunct says the candidate
  stays inside its own model's range (no overflow beyond ±2^53, no out-of-range index, ...) wherever the original does.

**Does not mean.**

* It is not a statement about the TypeScript function. The TypeScript is connected to the model only by the
  translator's design and by testing on N inputs (see "The sentence that must accompany Proved").
* It says nothing about inputs outside the preconditions: numbers outside ±2^53 or not whole, non-BMP strings,
  non-ASCII text reaching a case map, out-of-range indices, division by zero, strings longer than 2^24 UTF-16 units,
  recursion deeper than 500 calls, carved-out inputs, and (with the `no-throw` choice) inputs on which the original throws.
* It does not mean the spec is what you wanted. The spec is the one you agreed to after reading it and its challenge run;
  the proof is only as right as that agreement.
* For a candidate it does not directly state "candidate = original". It states candidate = spec. The link to the
  original is the original's own theorem (when that was proved) or, failing that, only the differential test.
* It does not say anything about speed, memory, the JavaScript engine, or behaviour when the module cannot load.

**Produced by.** `proveTheorem` (`packages/prover/src/prove.ts`) asks Codex for `helpers` and `proof` text and checks
every attempt with `checkProof` (`packages/prover/src/proofFile.ts`), in this order:

1. `vetProofText` refuses text containing `sorry`, `admit`, `axiom`, `opaque`, `unsafe`, `implemented_by` / `extern` /
   `csimp`, syntax extensions (`macro`, `syntax`, `notation`, `elab`, `infix`, ...), `open` / `namespace` / `section` /
   `end` / `variable` / `universe` / `import` / `mutual` at the start of a line, `#` commands, `set_option` other than
   `maxHeartbeats`, `maxRecDepth` and `linter.*`, redefinitions of `Faithful.*` names, and instance declarations or
   instance attributes. Comments are stripped before this check.
2. `buildProofFile` assembles the file: imports, the translator's model, the agreed spec, the helpers, then
   `theorem <name> : <statement> :=` and the proof. Only `helpers` and `proof` come from the model.
3. `checkLean` compiles it with `lean --json` under a wall-clock budget (process group killed on timeout).
4. Fingerprint: `#check @<thm>` output must equal the output for the same file with the proof replaced by `sorry`
   (`statementFingerprint`, cached per target). A mismatch is `statement-changed`, not a proof.
5. Axioms: `#print axioms <thm>`, classified by `tierFromAxioms`.

A failure at any step is a failed attempt; the loop stops on success or when the attempt budget or the time budget runs
out.

### Proved (trusting the compiler)

**Means.** Everything under Proved, except that the axiom list also contains an axiom that delegates part of the check
to compiled code: `Lean.ofReduceBool`, `Lean.trustCompiler`, or an axiom whose name matches
`<thm>._native.<name>.ax_<n>` / `ax_<n>_<m>` (what `native_decide` introduces in Lean 4.34, regex `NATIVE_AXIOM` in
`tiers.ts`). In addition to Lean's kernel, the claim trusts Lean's compiler and runtime to evaluate the decided
proposition correctly.

**Does not mean.** Everything Proved does not mean, and it is weaker than Proved: a bug in Lean's code generator or
runtime could make it false while the kernel would not have accepted the same fact. The prompt tells the model that
`native_decide` is accepted but downgrades the claim.

`VERIFY.md` (written by `verifyMarkdown` in `packages/cli/src/flow/deliver.ts`) words this more strictly: it says a
theorem depending on a `native_decide` axiom "is not a proof" and then names this label. The tier the code assigns is
`proved-trusting-compiler`; read it as "Lean accepted it, with the compiler in the trusted base".

**Produced by.** The same `checkProof` path; `tierFromAxioms` returns `proved-trusting-compiler` when at least one
compiler-trust axiom is present and every other axiom is in the allowed list.

### Verified to k

**Means (as implemented in `packages/smt`).** Z3 answered `unsat` to the bounded query of `checkEquivalent` /
`verifiedToK` (`packages/smt/src/equivalence.ts`). In the words of `encodingNote`: there is no input with every array of
at most `array` elements, every string of at most `string` UTF-16 units of BMP text and every number an integer in
[-int, int], on which the original stays inside the model (range-ok, and ascii where it applies) and both functions
finish within U iterations of each loop entry and U nested recursive calls, where the outcomes differ (return value,
thrown message, or the candidate leaving the model). k is `min(array, string)`. Both sides are encoded from the
translator's IR, not from the Lean text and not from the running JavaScript. A `sat` answer is replayed in the sandbox
and counts as a counterexample only when the replayed outcomes really differ; otherwise it is `inconclusive`.

**Does not mean.** Nothing about larger arrays or strings, wider integers, or inputs needing more iterations; nothing
about the spec (it compares candidate with original only); not a proof.

**Status in this build.** The SMT checker is wired: `packages/cli/src/smtChecker.ts` adapts `verifiedToK` to the optimizer, and it is assigned in the local server (`api.ts`, which `faithful optimize` also uses), in `faithful showcase-record`, in `scripts/measure.mjs` and in `faithful verify`. A candidate that passes the SMT stage is recorded at `verified-to-k` with the k that completed; a candidate outside the verifiable subset has the SMT stage recorded as `skipped` with the reason. If no Z3 is available (neither the WASM build nor a system binary), the stage is `skipped` and `faithful verify` says that a recorded Verified-to-k claim was NOT re-checked.

The label, the provenance claim kind `candidate-vs-original-smt`, and the delivery logic for it exist and are
described below so that recordings and future wiring are read correctly.

### Tested

**Means.** A candidate rewrite passed, in `Optimizer.funnel`:

1. the compile gate (strict TypeScript; same signature as the original);
2. the purity gate on up to 50 sample inputs, each called twice (no ambient global such as the clock, randomness, I/O
   or timers touched, no shared intrinsic modified, no global written, no argument mutated, the two calls agree);
3. the differential test `tsVsTs`: up to 1,000 inputs generated under the translator's preconditions and the carve-outs
   (seed `7000 + candidate id`), screened to those on which the instrumented original returns or throws within 100 ms;
   the candidate's outcome must equal the original's on every input where the original returned or threw. A candidate
   fault (timeout, crash, impurity) on such an input is a disagreement. Exception: when the user chose "treat the throw
   as a precondition", disagreements on inputs where the original throws are ignored (`onlyThrowOk`).

and then reached neither an `unsat` SMT answer nor an accepted Lean proof. `tested` is recorded as the candidate's
`tier` even when the candidate is then rejected for not being faster.

**Does not mean.** Equivalence on any input that was not generated; nothing about the spec; nothing about inputs on
which the original faulted or was slower than 100 ms (they are skipped and counted). The mutation check that runs with
the differential stage (12 broken copies of the original at most, seed 11, the first 300 differential inputs) measures
whether these inputs would notice a broken copy; it is informational, wrapped in a `try`, and never rejects a candidate.

**Refused functions: the Tested-only path.** The `Optimizer` constructor still refuses a function the translator
refused. Such a function continues on the Tested tier only through `SessionRuntime.startTestedOnly` (event
`tested.started`) and `TestedOptimizer` (`packages/cli/src/flow/tested.ts`; `POST /api/tested/start`,
`faithful optimize --tested`, or the Translate screen's "Optimize with the Tested tier only"). There is no model, spec,
agreement, proof or SMT check; the original function is the reference. The original runs as an extracted unit: the
function plus only the module-level declarations it uses, so unrelated imports and top-level code in its file are left
out (docs/SECURITY.md "Extracted units"; the whole file when extraction refuses but the file loads; which one ran is
recorded in `tested.started`, the provenance and VERIFY.md). The funnel is compile, purity, the differential
`jsVsJs` (`packages/engine/src/differential/jsdifferential.ts`) against the ORIGINAL on up to 1,000 inputs generated
from the TypeScript signature by `generateSignatureInputs` (`signature.ts`; seed `7000 + candidate id`; numbers are
integers AND non-integer doubles; NaN, Infinity, -Infinity and -0 only when the user opts in), the mutation check, and
the benchmark; the `smt` and `proof` stages are recorded as `skipped` with "outside the verifiable subset: <refusal
reason>". Both functions run in the sandbox's `'js'` value domain, where NaN, ±Infinity, -0 and `undefined` cross as
the sentinel objects of `jsvalues.ts`. Equality (`jsOutcomeEqual`): NaN equals NaN; -0 and 0 are different
(`Object.is`; a difference only in the sign of a zero is rejected and said in those words); `undefined` differs from
`null`; a thrown message must match. A candidate is kept only when it is also significantly faster. `deliverTested`
writes `patch.diff`, `<fn>.provenance.json` (one `candidate-vs-original-differential` claim at tier `tested`, the refusal
in `caveats` and `testedOnly`, empty model/spec/agreement/Lean hashes) and `VERIFY.md`; no `.lean` file and no
`spec.md`. `faithful verify` on it re-runs the differential from the recorded seed and says that no proof or SMT claim
exists. Never Proved or Verified to k.

### Not proved

**Means.** No accepted proof exists for the claim in question. It is produced when the proof loop ends without an
accepted proof (`failureLine`: exactly "Not proved (N attempts, M minutes)"), when `deliver` finds no accepted proof
for the original and no incumbent (`deliveredTier = 'not-proved'`, caveat "Nothing is proved for the delivered
function."), and by `buildEvidenceBlock` when no evidence piece exists (the line is "Not proved.").

**Does not mean.** That the function is wrong, that the spec is wrong, or that a counterexample exists. A failed proof
is a failed proof; it is never reported as anything else, and never upgraded.

## Axiom policy

`tierFromAxioms(axioms)` (`packages/core/src/tiers.ts`):

| Axiom reported by `#print axioms` | Effect |
|---|---|
| none ("does not depend on any axioms") | Proved |
| `propext`, `Classical.choice`, `Quot.sound` (`ALLOWED_AXIOMS`) | allowed; Proved |
| `Lean.ofReduceBool`, `Lean.trustCompiler` (`COMPILER_TRUST_AXIOMS`) | downgrade to Proved (trusting the compiler) |
| `<thm>._native.<name>.ax_<n>` or `..._ax_<n>_<m>` (one per `native_decide` use in Lean 4.34) | downgrade to Proved (trusting the compiler) |
| `sorryAx`, or any other axiom | not a proof (`null`): the attempt fails with reason `bad-axioms` |

Axiom declarations in model-written text are refused before compiling (`vetProofText`), so a proof cannot introduce
its own axiom; the axiom check is a second line of defence. The translator's own definitions never use `sorry`,
`partial` or `unsafe` (docs/TRANSLATOR.md section 8).

## The sentence that must accompany Proved

`provedSentence(N)` in `packages/core/src/tiers.ts` produces, for example with N = 1,000:

> Proved for the Lean model of this function. The model is produced by a fixed translator (docs/TRANSLATOR.md) and checked against the TypeScript on 1,000 inputs.

Why: the theorem is about the Lean model, and the only link from that model to the TypeScript that actually runs is (a)
the translator's design and (b) a differential check of model against TypeScript on N generated inputs. A bare
"Proved" would invite the reading that the TypeScript itself was proved on every input. The sentence names the object
of the proof and the size of the test that ties it to the code.

Where it is enforced:

* `buildEvidenceBlock` (`packages/engine/src/evidence/evidence.ts`) throws if a proof tier is given without a
  differential count, or without the Lean version and Mathlib commit in the `Stamp`; its `text` is the line followed by
  the sentence, and every returned text passes `lintEvidenceText`, which flags "Proved" without the sentence.
* The UI's `tierText` (`apps/ui/src/lib/tierText.ts`) withholds the label ("Lean proof accepted", with a note) when no
  model check is recorded, and otherwise renders the sentence beneath the label.
* `deliver` adds the sentence to `provenance.caveats` whenever a proof tier is delivered.

What N is: the `agreements` count of `tsVsLean` run by `SessionRuntime.checkModel` with seed 424242, on 1,000 generated
inputs for the original (after its proof is accepted) and 600 for a candidate (after its proof is accepted). An input
counts only if the TypeScript returned or threw within budget, the Lean model's outcome is identical, and Lean's
`rangeOk` / `asciiOk` / `pre` are all true. Inputs outside the model (range violations), TypeScript faults and inputs too
costly for Lean (more than 20 ms or a result over 100,000 characters) are not counted. N is therefore usually smaller
than the number of inputs generated.

## The translator trust boundary

"Proved" holds for the Lean model. The model is checked against the TypeScript on N inputs; it is not proved equal to
the TypeScript. What the model leaves out is stated as preconditions, and the theorem assumes them:

* **UTF-16.** Strings are lists of Lean `Char`, one per UTF-16 code unit, which matches JavaScript only for Basic
  Multilingual Plane text. Emoji and other astral characters (two code units) and lone surrogates are outside the model
  (`bmp` precondition; such literals are refused).
* **Case mapping.** `toLowerCase` / `toUpperCase` are modeled on ASCII letters only; JavaScript maps full Unicode,
  sometimes changing the length (`"ß"` to `"SS"`). Every string that reaches a case map must be ASCII (`ascii`).
* **±2^53.** `number` is an unbounded Lean `Int`; every number in the arguments and every intermediate value must be a
  whole number within [-2^53, 2^53] (`int-bound`, `range-ok`). Outside that range JavaScript rounds and the model would
  not.
* **range-ok.** Also requires every index in bounds (out of range JavaScript gives `undefined` / `NaN` and the model an
  arbitrary default), no division or remainder by zero, no concatenated or joined string longer than 2^24 UTF-16 units, and,
  for a recursive function, at most 500 active calls.
* Further gaps the precondition does not cover: arrays have no length bound (a function that builds an enormous array
  exhausts memory in JavaScript while the theorem still covers that input), a function with very large frames can
  overflow the JavaScript stack below depth 500, `-0` is assumed unobservable, and sort agreement relies on a stable
  engine sort (ES2019 or later). docs/TRANSLATOR.md section 14 lists every known gap.

## How carve-outs are marked

A carve-out is recorded when the user rules "my function is wrong" on a challenge and chooses to exclude a class of
inputs (negative / zero / positive / equal to a value, empty / of a given length, or that exact input), picked from a
menu generated by `carveOptions` (`packages/cli/src/flow/carveout.ts`, no model, no free text). It is a `Precondition`
with `kind: 'carve-out'`, a Lean `Bool` term and a JavaScript expression, both true for kept inputs. It is marked:

* as an extra hypothesis `<carve-out> = true` in every theorem (original and candidate), and the theorem's words gain
  "and the stated carve-outs/choices";
* in the agreement hash (spec, preconditions, carve-outs and rulings), so changing a carve-out invalidates the agreement;
  on invalidation the proofs pinned to the old hash are kept as history (`stoppedBy: 'spec-changed'`) and the incumbent
  is cleared;
* as an input filter for the differential test, the challenge search and the benchmark distribution;
* in the delivery: a "Carve-outs (known problems you chose to exclude)" section of `spec.md`, `carveOuts` in
  `provenance.json`, and the caveat "This result excludes carved-out inputs: ..." in `provenance.caveats`;
* in the UI: `CarveOutBand`, a band at the top of the screen, "excluded from every claim, recorded permanently".

## How "accepted at Verified to k" is marked

A candidate that passed the differential, reached `verified-to-k`, and was faster but not proved is shown with outcome
`faster-not-proved`. It becomes the incumbent only if the user explicitly accepts it (`acceptFasterNotProved`), which
requires its tier to be `verified-to-k`. The acceptance is marked as:

* outcome `accepted-at-verified` in the session;
* a `candidate-vs-original-smt` claim with `acceptedByUser: true` and the statement "Accepted by the user at the
  Verified-to-k tier; not proved.";
* the caveat "The optimized function was accepted by the user at the Verified-to-k tier. It is NOT proved." in
  `provenance.caveats`;
* the patch header comment `// Optimized by Faithful (<label>)`, which carries the delivered tier's label;
* in the UI: "You accepted this candidate below the proof tier. The delivery marks it as not proved."

In this build no candidate reaches `verified-to-k` (see above), so this path is not reachable from the CLI.

## How the evidence line is built

`buildEvidenceBlock` (`packages/engine/src/evidence/evidence.ts`) emits one sentence per piece of evidence that exists,
in a fixed order, then the Proved sentence when a proof piece is present:

> Proved against the agreed spec (Lean 4.34.0, Mathlib 5ed2965). Verified to k=6. 1,000 differential inputs. 12 of 12 broken copies caught. 4.2× faster (95% CI 3.9–4.6) on the declared distribution. Proved for the Lean model of this function. The model is produced by a fixed translator (docs/TRANSLATOR.md) and checked against the TypeScript on 1,000 inputs.

(The numbers above are the unit test's example, not a measurement.)

| Piece | Text | Where `deliver` gets the fact |
|---|---|---|
| proof | `<label> against the agreed spec (Lean <x.y.z>, Mathlib <7 hex>).` | tier: when there is an incumbent, `tierFromAxioms` of its accepted proof (no proof piece if it has none, even when the original was proved); with no incumbent, of the original's accepted proof; Lean version: regex over `lean --version` text in the `Stamp`; Mathlib: first 7 characters of the `lake-manifest.json` rev in the `Stamp`. Neither version may be typed in; without them the builder throws. |
| bounded | `Verified to k=<k>.` | the incumbent's SMT stage detail when its result is `unsat` |
| differential | `<N> differential inputs.` | `modelChecks`: the latest model check of the delivered function (the candidate's if there is an incumbent, else the original's); N is its `agreements`. This is the same N as in the Proved sentence. |
| mutation | `<k> of <m> broken copies caught.` | the incumbent's differential-stage detail (`mutationCheck`, seed 11) |
| speed | `<r>× faster (95% CI <lo>–<hi>) on the declared distribution.`, or `slower`, or `No speed difference distinguished ... (speed-up 95% CI ...)` | `inc.speedup`: the incumbent's benchmark against the **original** (not against the previous incumbent). The word "faster" appears only for the verdict `faster`, i.e. non-overlapping intervals (docs/BENCH.md). `deliver` passes `faster` or `not-distinguished` only (from `significant`), so a delivered line never uses the `slower` wording. |
| (none) | `Not proved.` | no piece present |

Rules checked by the builder: counts must be non-negative integers, caught ≤ total, k ≥ 1, the speed-up interval must
have lo ≤ hi, and the whole text must pass `lintEvidenceText`.

Two other builders exist and differ from this one in their sources:

* `faithful verify` builds a line from the Lean axioms it re-checked, with the differential count hard-coded to 300 (the
  size of its own model check) rather than the number of inputs that check actually agreed on.
* The UI builds its own line (`apps/ui/src/lib/evidence.ts`) from session state. Its "differential inputs" count is the
  candidate-versus-original differential count (`compared`), its Proved sentence uses the candidate's model check, and
  it appends a note when that model check found disagreements.

## Delivered tier

`deliver` sets `deliveredTier` to the strongest tier the incumbent reached: an accepted proof (by its axioms), else an
`unsat` SMT result, else `tested`. With no incumbent it is the original's proof tier, or `not-proved`. The comment on
`Provenance.deliveredTier` in `packages/session/src/provenance.ts` says "the weakest tier among claims the delivery
rests on"; the code does not compute a weakest tier, and the separate claims in `provenance.json` each carry their own
tier.

## What would make each claim false

| Claim | It would be false if | What guards against it | Residual risk |
|---|---|---|---|
| Proved (original) | the Lean kernel accepted an invalid proof | Lean's kernel | trusted |
| Proved | the checked statement is not the one Faithful wrote (redefined notation, shadowed names, changed instances) | `vetProofText` refusals; `#check @thm` fingerprint equals the `sorry` version | text vetting is a regex list over comment-stripped text; the fingerprint is the real check |
| Proved | the proof rests on `sorry` or an added axiom | `vetProofText`; `#print axioms` through `tierFromAxioms` | none known |
| Proved | the Lean model does not compute what the TypeScript computes on some input inside the preconditions (translator bug) | translator design; N-input model check; differential corpus runs and red-team probes (docs/TRANSLATOR.md 12, 13) | tested, not proved |
| Proved | the model check that supplied N found disagreements | recorded in `modelChecks` with its `disagreements` count; the UI prints a note beside the label | `deliver` and `buildEvidenceBlock` do not refuse or downgrade on disagreements; N counts agreements only |
| Proved | a precondition excludes the input you care about (emoji, non-ASCII case mapping, beyond ±2^53, deep recursion, carve-out) | preconditions in words on the agreement screen, in `spec.md` and `provenance.json` | by design: the claim is silent there |
| Proved | the agreed spec is not what you meant | challenge search before agreement; spec shown line by line in English and Lean | your reading of the spec |
| Proved (candidate) | the candidate differs from the original | candidate = spec and original = spec together imply it on the model; differential test | if the original's theorem was not proved, only the differential test links candidate to original |
| Proved (trusting the compiler) | Lean's compiler or runtime evaluates a `native_decide` proposition wrongly | nothing beyond Lean itself | the reason for the separate label |
| Verified to k | the SMT encoding of the IR differs from JavaScript on some input within the bounds | `sat` answers are replayed in the sandbox; SMT sanity mode against Lean `#eval` | unreachable in this build (`rt.smt` never set) |
| Verified to k | the difference needs a larger input, wider integers or more iterations | none: stated in `encodingNote` | by design |
| Tested | the candidate differs on an input that was not generated | up to 1,000 generated inputs; the mutation check reports whether these inputs notice broken copies | by design |
| Tested | the candidate differs only where the original throws, with the throw-as-precondition choice | intended: those inputs are excluded by the `no-throw` precondition | by design |
| `N differential inputs` (deliver) | read as the candidate-versus-original count | the piece's source is documented above | the UI and `deliver` use different counts under the same words |
| evidence line from `faithful verify` | read as 300 agreeing inputs | its "model vs TypeScript" check line prints the real agreement count | the evidence line itself says 300 |
| `<r>× faster` | the speed-up does not hold on your inputs, machine or Node version | non-overlapping intervals (each a 95% CI of the median) on the declared distribution (docs/BENCH.md) | the claim is about the declared distribution on the measuring machine only |
| Not proved | (it is the absence of a claim) | | |
