/**
 * DEVELOPMENT FIXTURE, NOT A RECORDING (see ./common.ts). Naive recursive fibonacci against the mathematical spec:
 *   spec proposal with English lines -> boundary challenge (negative n) ruled with a carve-out -> agreement ->
 *   original proved on the second attempt (the first fails with a goal state) -> optimize:
 *     candidate 1: iterative with an off-by-one guard (`n <= 2`), passes 1,000 differential inputs drawn from the
 *                  declared distribution (n in 5..9, which never includes 2), REJECTED by the SMT stage at n = 2;
 *     candidate 2: iterative, correct, proof accepted by Lean, 4.2x faster (95% CI 3.9-4.6);
 *     candidate 3: two-steps-per-iteration loop, Verified to k=6, faster but not proved;
 *   -> delivery.
 * The event shapes follow the real server (packages/cli/src/flow): typed stage details (session details.ts), the
 * server's own stage summaries, `model.checked` events for N, the budget on `proof.started`, a carve-out ruling that
 * re-runs the challenge, no benchmark for a candidate rejected before the benchmark stage, and the real delivery file
 * names. Two liberties, both labelled by the fixture banner: the model checks are emitted right after the proofs (the
 * server currently records the original's at delivery and none for candidates), and every number is invented.
 */
import type { CallRecord, CandidateRecord, SessionEvent, StageResult } from '@faithful/session';
import type { Precondition } from '@faithful/translate';
import { FIXTURE_TOOLCHAIN, at, fakeHash, timeline, type Fixture } from './common';

export const FIB_SOURCE = `/** The n-th Fibonacci number. */
export function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
`;

export const FIB_LEAN_MODEL = `import Faithful.Core

namespace Model

def fib (n : Int) : Int :=
  if n ≤ 1 then n else fib (n - 1) + fib (n - 2)
termination_by n.toNat
decreasing_by all_goals omega

def fib_rangeOk (n : Int) : Bool :=
  if n ≤ 1 then Faithful.inRange n
  else fib_rangeOk (n - 1) && fib_rangeOk (n - 2) && Faithful.inRange (fib (n - 1) + fib (n - 2))
termination_by n.toNat
decreasing_by all_goals omega

def fib_pre (n : Int) : Bool := Faithful.inBounds n && fib_rangeOk n

end Model
`;

export const SPEC_LEAN = `def Spec.fibNat : Nat → Nat
  | 0 => 0
  | 1 => 1
  | k + 2 => Spec.fibNat k + Spec.fibNat (k + 1)

def Spec.spec (n : Int) : Int := Int.ofNat (Spec.fibNat n.toNat)
`;

/** Candidate 1: the guard should be `n <= 1`. At n = 2 it returns 2; fib(2) is 1. Agrees at n = 0, 1 and n >= 3. */
export const CANDIDATE_OFF_BY_ONE = `export function fib(n: number): number {
  if (n <= 2) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return b;
}
`;

/** Candidate 2: correct; the last sum computed is fib(n) itself, so it never leaves the range the original stays in. */
export const CANDIDATE_ITERATIVE = `export function fib(n: number): number {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return b;
}
`;

/** Candidate 3: two steps per iteration; invariant a = fib(i - 1), b = fib(i). Correct, but its proof did not close. */
export const CANDIDATE_TWO_STEP = `export function fib(n: number): number {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  let i = 1;
  while (i + 2 <= n) {
    a = a + b;
    b = a + b;
    i += 2;
  }
  return i === n ? b : a + b;
}
`;

const SPEC_HASH = fakeHash('spec:fib:1');
const AGREE_HASH = fakeHash('agree:fib:1');
const DISTRIBUTION = 'n uniform in 5..9';

const PRE_INT: Precondition = {
  id: 'int-bound:n',
  kind: 'int-bound',
  words: 'n is an integer with |n| ≤ 2^53.',
  lean: 'Faithful.inBounds n',
  ts: 'Number.isInteger(n) && Math.abs(n) <= 2 ** 53',
};
const PRE_RANGE: Precondition = {
  id: 'range-ok',
  kind: 'range-ok',
  words: 'Every intermediate value stays an integer within ±2^53. For fib this holds exactly when n ≤ 78.',
  lean: 'Model.fib_rangeOk n',
};
const CARVE_NONNEG: Precondition = {
  // The id records the class (fixture convention; the server's ids are hashes) so a driven fixture can reuse it.
  id: 'carve-negative-0',
  kind: 'carve-out',
  words: 'Carved out (known problem in the original): inputs where n is negative are excluded from everything proved below.',
  lean: 'decide (n ≥ 0)',
  ts: '(n >= 0)',
};

const Z3 = FIXTURE_TOOLCHAIN.z3!;
const SMT_ENCODING = 'integers as unbounded Int; n bounded to |n| ≤ 64';

const PROMPT_HEADER = `You are helping verify a TypeScript function with Lean 4 (v4.34.0, core only: no Mathlib).
You cannot run tools. Answer with one JSON object and nothing else.`;

function specPrompt(): string {
  return `${PROMPT_HEADER}

TASK: write a SPECIFICATION of what this function is meant to compute. Do not restate its algorithm.

TypeScript (verbatim):
${FIB_SOURCE}
Lean model of the function (fixed; produced by a deterministic translator; do not change it):
${FIB_LEAN_MODEL}
Write \`def Spec.spec (n : Int) : Int\` (you may add helper definitions prefixed \`Spec.\`). It must be executable
(#eval) and must not mention \`Model\`. Explain each line in plain English for a developer who does not read Lean.

Reply as:
{"lean": "...", "lines": [{"lean": "...", "english": "..."}], "properties": [{"name": "...", "lean": "...", "english": "..."}], "english": "..."}`;
}

function proofPrompt(attempt: number, previous?: { proof: string; goal: string }): string {
  return `${PROMPT_HEADER}

TASK: prove the theorem below. Lean will check your proof; \`sorry\`, \`admit\` and new axioms are rejected.
Available: Faithful.Tactics (omega, simp, linarith, ring, norm_num, positivity).

${FIB_LEAN_MODEL}
${SPEC_LEAN}
theorem original_meets_spec (n : Int) (h : Model.fib_pre n = true) (h₀ : 0 ≤ n) :
    Model.fib n = Spec.spec n := by
  <your proof>
${
  previous
    ? `
Attempt ${attempt - 1} failed. Your proof was:
${previous.proof}
Lean reported unsolved goals:
${previous.goal}
`
    : ''
}
Reply as: {"helpers": "<lemmas placed before the theorem, may be empty>", "proof": "<tactic block>"}`;
}

function candidatePrompt(round: number): string {
  return `${PROMPT_HEADER}

TASK: write a faster TypeScript function with exactly the same behavior as the original on every input that meets the
agreed preconditions. It will be compiled, checked for purity, differentially tested, checked with Z3 up to a bound
and proved equal to the agreed spec in Lean. Use only integer arithmetic, no bitwise operators, no globals.

Original (verbatim):
${FIB_SOURCE}
Agreed spec:
${SPEC_LEAN}
Preconditions, in plain words:
- ${PRE_INT.words}
- ${PRE_RANGE.words}
- ${CARVE_NONNEG.words}

Benchmark distribution: ${DISTRIBUTION}. Round ${round}.
Reply as: {"source": "<the complete exported function>", "idea": "<one sentence>"}`;
}

let callAt = 0;
function call(id: number, purpose: CallRecord['purpose'], prompt: string, response: string, ms: number, tokens: [number, number]): CallRecord {
  callAt += ms + 4_000;
  return {
    id,
    purpose,
    prompt,
    response,
    model: FIXTURE_TOOLCHAIN.codex.model,
    effort: FIXTURE_TOOLCHAIN.codex.effort,
    ms,
    inputTokens: tokens[0],
    outputTokens: tokens[1],
    error: null,
    startedAt: at(callAt),
  };
}

const ATTEMPT1_PROOF = `  induction n using Int.induction_on with
  | hz => simp [Model.fib, Spec.spec, Spec.fibNat]
  | hp k ih =>
    unfold Model.fib
    simp [Spec.spec]
    omega
  | hn k _ => omega`;

export const ATTEMPT1_GOAL = `case hp
k : ℕ
ih : 0 ≤ ↑k → Model.fib ↑k = Spec.spec ↑k
h : Model.fib_pre (↑k + 1) = true
h₀ : 0 ≤ ↑k + 1
⊢ Model.fib (↑k + 1 - 1) + Model.fib (↑k + 1 - 2) = ↑(Spec.fibNat (k + 1))`;

const ATTEMPT2_HELPERS = `theorem fib_eq_fibNat (m : Nat) : Model.fib (m : Int) = (Spec.fibNat m : Int) := by
  induction m using Nat.strong_induction_on with
  | _ m ih =>
    match m with
    | 0 => simp [Model.fib, Spec.fibNat]
    | 1 => simp [Model.fib, Spec.fibNat]
    | k + 2 =>
      rw [Model.fib]
      simp only [show ¬((k : Int) + 2 ≤ 1) by omega, if_false]
      have h1 := ih (k + 1) (by omega)
      have h2 := ih k (by omega)
      rw [show (k : Int) + 2 - 1 = ((k + 1 : Nat) : Int) by push_cast; ring,
          show (k : Int) + 2 - 2 = (k : Int) by ring, h1, h2]
      simp [Spec.fibNat]; push_cast; ring`;

const ATTEMPT2_PROOF = `  obtain ⟨m, rfl⟩ := Int.eq_ofNat_of_zero_le h₀
  simp [Spec.spec, fib_eq_fibNat]`;

const THEOREM = `theorem original_meets_spec (n : Int) (h : Model.fib_pre n = true) (h₀ : 0 ≤ n) :
    Model.fib n = Spec.spec n`;

const CAND3_THEOREM = `theorem candidate_3_meets_spec (n : Int) (h : Model.fib_pre n = true) (h₀ : 0 ≤ n) :
    Cand3.fib n = Spec.spec n`;

export const CAND3_GOAL = `case step
i a b : ℤ
hi : i + 2 ≤ n
inv : a = Spec.spec (i - 1) ∧ b = Spec.spec i
⊢ Cand3.fib.loop n (i + 2) (a + b) (a + b + b) = Spec.spec n`;

function stages(list: Array<[StageResult['stage'], StageResult['status'], number, string, Record<string, unknown>?]>): StageResult[] {
  return list.map(([stage, status, ms, summary, detail]) => (detail ? { stage, status, ms, summary, detail } : { stage, status, ms, summary }));
}

function proposed(id: number, round: number, source: string, callId: number): CandidateRecord {
  return { id, round, source, callId, stages: [], rejection: null, tier: null, outcome: 'running', bench: null, speedup: null };
}

function stageEvents(candidateId: number, rs: StageResult[]): Array<[number, SessionEvent]> {
  return rs.map((result) => [Math.max(result.ms, 40), { kind: 'stage.result', candidateId, result }]);
}

const calls = {
  spec: call(
    1,
    'spec-proposal',
    specPrompt(),
    JSON.stringify({ lean: SPEC_LEAN, english: 'fib(n) is the n-th Fibonacci number: 0, 1, 1, 2, 3, 5, … Negative n counts as 0.' }),
    37_800,
    [19_412, 611],
  ),
  attempt1: call(2, 'proof-attempt', proofPrompt(1), JSON.stringify({ helpers: '', proof: ATTEMPT1_PROOF }), 29_300, [19_980, 402]),
  attempt2: call(
    3,
    'proof-attempt',
    proofPrompt(2, { proof: ATTEMPT1_PROOF, goal: ATTEMPT1_GOAL }),
    JSON.stringify({ helpers: ATTEMPT2_HELPERS, proof: ATTEMPT2_PROOF }),
    44_100,
    [20_377, 1_018],
  ),
  cand1: call(4, 'candidate', candidatePrompt(1), JSON.stringify({ source: CANDIDATE_OFF_BY_ONE, idea: 'Iterate instead of recursing.' }), 21_600, [19_733, 287]),
  cand2: call(5, 'candidate', candidatePrompt(1), JSON.stringify({ source: CANDIDATE_ITERATIVE, idea: 'Iterate with two accumulators.' }), 19_900, [19_733, 281]),
  cand3: call(6, 'candidate', candidatePrompt(2), JSON.stringify({ source: CANDIDATE_TWO_STEP, idea: 'Advance two Fibonacci steps per iteration.' }), 26_400, [19_901, 344]),
};

function candProofPrompt(cand: number, source: string, attempt: number): string {
  return `${PROMPT_HEADER}

TASK: prove that candidate ${cand} meets the agreed spec. Lean will check your proof; \`sorry\`, \`admit\` and new axioms
are rejected. Available: Faithful.Tactics (omega, simp, linarith, ring, norm_num, positivity).

Candidate (TypeScript, verbatim):
${source}
${SPEC_LEAN}
theorem cand${cand}_meets_spec (n : Int) (h : Model.fib_pre n = true) (h₀ : 0 ≤ n) :
    Cand${cand}.fib n = Spec.spec n := by
  <your proof>

Attempt ${attempt}.
Reply as: {"helpers": "<lemmas>", "proof": "<tactic block>"}`;
}

const candProofCalls = {
  c2a1: call(7, 'proof-attempt', candProofPrompt(2, CANDIDATE_ITERATIVE, 1), '{"helpers":"","proof":"  induction n ..."}', 24_800, [20_102, 512]),
  c2a2: call(8, 'proof-attempt', candProofPrompt(2, CANDIDATE_ITERATIVE, 2), '{"helpers":"theorem loop_inv ...","proof":"  ..."}', 31_500, [20_744, 903]),
  c3a1: call(9, 'proof-attempt', candProofPrompt(3, CANDIDATE_TWO_STEP, 1), '{"helpers":"","proof":"  ..."}', 33_000, [20_131, 611]),
  c3a2: call(10, 'proof-attempt', candProofPrompt(3, CANDIDATE_TWO_STEP, 2), '{"helpers":"theorem step2 ...","proof":"  ..."}', 41_700, [20_890, 1_140]),
  c3a3: call(11, 'proof-attempt', candProofPrompt(3, CANDIDATE_TWO_STEP, 3), '{"helpers":"theorem step2 ...","proof":"  ..."}', 47_200, [21_302, 1_288]),
};

const diff = (seed: number, mutation: { caught: number; total: number; undistinguished: number }) => ({
  stage: 'differential',
  generated: 1000,
  skippedSlow: 0,
  compared: 1000,
  seed,
  mutation: { ...mutation, seed: 11 },
});
const smt = (result: 'unsat' | 'sat') => ({ stage: 'smt', k: 6, bounds: { array: 6, string: 6, int: 64 }, budgetMs: 60_000, z3: Z3, result, encoding: SMT_ENCODING });
const benchDetail = { stage: 'benchmark', trials: 30, distribution: DISTRIBUTION, sizes: [9] };

const CAND1_STAGES = stages([
  ['compile', 'pass', 412, 'compiles under strict TypeScript; signature matches'],
  ['purity', 'pass', 38, 'pure on a sample: no I/O, clock, randomness or input mutation'],
  ['differential', 'pass', 1_930, '1000 inputs, no difference; 12 of 12 broken copies of the original caught', diff(7001, { caught: 12, total: 12, undistinguished: 0 })],
  ['smt', 'fail', 3_420, 'Z3 found an input where the candidate differs', smt('sat')],
]);

const CAND2_STAGES = stages([
  ['compile', 'pass', 398, 'compiles under strict TypeScript; signature matches'],
  ['purity', 'pass', 41, 'pure on a sample: no I/O, clock, randomness or input mutation'],
  ['differential', 'pass', 1_870, '1000 inputs, no difference; 12 of 12 broken copies of the original caught', diff(7002, { caught: 12, total: 12, undistinguished: 0 })],
  ['smt', 'pass', 5_210, 'no distinguishing input up to k=6', smt('unsat')],
  [
    'proof',
    'pass',
    72_400,
    'Proved against the agreed spec in 2 attempts',
    { stage: 'proof', theoremId: 'candidate_2_meets_spec', against: 'spec', axioms: ['propext', 'Classical.choice', 'Quot.sound'], attempts: 2 },
  ],
  ['benchmark', 'pass', 8_300, 'faster than the original: 4.2× (95% CI 3.9–4.6)', benchDetail],
]);

const CAND3_STAGES = stages([
  ['compile', 'pass', 405, 'compiles under strict TypeScript; signature matches'],
  ['purity', 'pass', 40, 'pure on a sample: no I/O, clock, randomness or input mutation'],
  ['differential', 'pass', 1_910, '1000 inputs, no difference; 11 of 12 broken copies of the original caught', diff(7003, { caught: 11, total: 12, undistinguished: 1 })],
  ['smt', 'pass', 6_080, 'no distinguishing input up to k=6', smt('unsat')],
  ['proof', 'fail', 180_000, 'Not proved (3 attempts, 3.0 minutes)', { stage: 'proof', theoremId: 'candidate_3_meets_spec', against: 'spec', axioms: [], attempts: 3 }],
  ['benchmark', 'pass', 8_200, 'faster than the original: 5.1× (95% CI 4.7–5.5)', benchDetail],
]);

const CAND3_REJECTION = {
  stage: 'proof' as const,
  kind: 'proof-failed' as const,
  reason: 'Not proved (3 attempts, 3.0 minutes): Lean could not prove that the candidate meets the agreed spec',
  goal: CAND3_GOAL,
  theorem: CAND3_THEOREM,
};

const BASELINE = { median: 61.4, lo: 60.2, hi: 62.9, unit: 'ns/pass' as const, trials: 30, distribution: DISTRIBUTION, sizes: [9] };

export const catchFixture: Fixture = {
  name: 'catch',
  title: 'fib(n): naive recursion, one wrong candidate caught',
  fixture: true,
  events: timeline([
    [0, { kind: 'session.started', fn: 'fib', file: 'src/math/fib.ts', source: FIB_SOURCE, sourceHash: fakeHash(FIB_SOURCE), toolchain: FIXTURE_TOOLCHAIN }],
    [
      246,
      {
        kind: 'translate.done',
        result: {
          ok: true,
          value: {
            ok: true,
            fnName: 'fib',
            params: [{ name: 'n', ty: { k: 'int' } }],
            ret: { k: 'int' },
            canThrow: false,
            throwSites: [],
            lean: {
              source: FIB_LEAN_MODEL,
              names: { original: 'Model.fib', rangeOk: 'Model.fib_rangeOk', pre: 'Model.fib_pre' },
              paramTypes: ['Int'],
              retType: 'Int',
              hash: fakeHash(FIB_LEAN_MODEL),
            },
            preconditions: [PRE_INT, PRE_RANGE],
            source: { text: FIB_SOURCE, hash: fakeHash(FIB_SOURCE) },
            instrumentedTs: FIB_SOURCE.replace('fib(n - 1) + fib(n - 2)', '__rc(__rc(fib(__rc(n - 1)) + fib(__rc(n - 2))))'),
            notes: [],
          },
        },
      },
    ],
    [37_800, { kind: 'call.recorded', call: calls.spec }],
    [
      310,
      {
        kind: 'spec.proposed',
        proposal: {
          id: 1,
          kind: 'proposal',
          lean: SPEC_LEAN,
          lines: [
            { lean: '| 0 => 0', english: 'The 0th Fibonacci number is 0.' },
            { lean: '| 1 => 1', english: 'The 1st is 1.' },
            { lean: '| k + 2 => Spec.fibNat k + Spec.fibNat (k + 1)', english: 'Every later one is the sum of the two before it.' },
            { lean: 'def Spec.spec (n : Int) : Int := Int.ofNat (Spec.fibNat n.toNat)', english: 'For an integer n the result is the n-th Fibonacci number; a negative n counts as 0.' },
          ],
          properties: [
            { name: 'Spec.nonneg', lean: 'def Spec.nonneg : Prop := ∀ n : Int, 0 ≤ Spec.spec n', english: 'The result is never negative.' },
            {
              name: 'Spec.recurrence',
              lean: 'def Spec.recurrence : Prop := ∀ n : Int, 2 ≤ n → Spec.spec n = Spec.spec (n - 1) + Spec.spec (n - 2)',
              english: 'From n = 2 on, each result is the sum of the previous two.',
            },
          ],
          english: 'fib(n) is the n-th Fibonacci number: 0, 1, 1, 2, 3, 5, … A negative n counts as 0.',
          callId: 1,
          validation: { ok: true, hash: SPEC_HASH },
        },
      },
    ],
    [
      2_140,
      {
        kind: 'challenge.run',
        run: {
          id: 1,
          specHash: SPEC_HASH,
          inputsTried: 1000,
          inputsCompared: 641,
          disagreements: [
            { id: 'ch-1', input: [-1], spec: { tag: 'ok', value: 0 }, original: { tag: 'ok', value: -1 }, origin: 'boundary' },
            { id: 'ch-2', input: [-7], spec: { tag: 'ok', value: 0 }, original: { tag: 'ok', value: -7 }, origin: 'random' },
          ],
          totalDisagreements: 2,
          carveOutIds: [],
          ms: 2_140,
          seed: 20261004,
        },
      },
    ],
    [
      41_000,
      {
        kind: 'ruling.made',
        ruling: { challengeId: 'ch-1', specHash: SPEC_HASH, ruling: 'function-wrong', then: 'carve-out', carveOut: CARVE_NONNEG },
      },
    ],
    // The server re-runs the challenge after a carve-out: the class covers ch-2 as well, so no ruling is needed for it.
    [
      1_980,
      {
        kind: 'challenge.run',
        run: { id: 2, specHash: SPEC_HASH, inputsTried: 1000, inputsCompared: 1000, disagreements: [], totalDisagreements: 0, carveOutIds: [CARVE_NONNEG.id], ms: 1_980, seed: 20260102 },
      },
    ],
    [
      18_400,
      {
        kind: 'spec.agreed',
        agreement: {
          specHash: SPEC_HASH,
          specLean: SPEC_LEAN,
          english: 'fib(n) is the n-th Fibonacci number: 0, 1, 1, 2, 3, 5, …',
          preconditions: [PRE_INT, PRE_RANGE],
          carveOuts: [CARVE_NONNEG],
          rulings: [{ challengeId: 'ch-1', specHash: SPEC_HASH, ruling: 'function-wrong', then: 'carve-out', carveOut: CARVE_NONNEG }],
          throwChoice: null,
          hash: AGREE_HASH,
          at: at(110_000),
        },
      },
    ],
    [
      1_200,
      {
        kind: 'proof.started',
        proof: {
          theoremId: 'original_meets_spec',
          statement: THEOREM,
          statementWords: 'For every n that meets the preconditions and the carve-out, the Lean model of fib returns the same value as the agreed spec.',
          pinnedTo: AGREE_HASH,
          attempts: [],
          result: 'running',
          accepted: null,
          ms: 0,
          budget: { maxAttempts: 3, minutes: 5 },
        },
      },
    ],
    [29_300, { kind: 'call.recorded', call: calls.attempt1 }],
    [
      11_900,
      {
        kind: 'proof.attempt',
        theoremId: 'original_meets_spec',
        attempt: {
          n: 1,
          callId: 2,
          helpers: '',
          proof: ATTEMPT1_PROOF,
          verdict: 'failed',
          failureReason: 'unsolved goals: plain induction gives a hypothesis for k only, and fib (k + 1) also needs k - 1',
          diagnostics: [{ line: 14, column: 4, message: 'unsolved goals', goal: ATTEMPT1_GOAL }],
          ms: 41_200,
        },
      },
    ],
    [44_100, { kind: 'call.recorded', call: calls.attempt2 }],
    [
      14_800,
      {
        kind: 'proof.attempt',
        theoremId: 'original_meets_spec',
        attempt: { n: 2, callId: 3, helpers: ATTEMPT2_HELPERS, proof: ATTEMPT2_PROOF, verdict: 'proved', diagnostics: [], ms: 58_900 },
      },
    ],
    [
      90,
      {
        kind: 'proof.done',
        theoremId: 'original_meets_spec',
        result: 'proved',
        accepted: {
          helpers: ATTEMPT2_HELPERS,
          proof: ATTEMPT2_PROOF,
          source: `${FIB_LEAN_MODEL}\n${SPEC_LEAN}\n${ATTEMPT2_HELPERS}\n\n${THEOREM} := by\n${ATTEMPT2_PROOF}\n\n#print axioms original_meets_spec\n`,
          axioms: ['propext', 'Classical.choice', 'Quot.sound'],
        },
        ms: 100_100,
      },
    ],
    [2_310, { kind: 'model.checked', check: { subject: 'original', candidateId: null, inputs: 1000, disagreements: 0, seed: 424242, ms: 2_310 } }],
    [9_500, { kind: 'optimize.started', threshold: { kind: 'speedup', target: 3, distribution: DISTRIBUTION }, baseline: BASELINE, at: at(230_000) }],
    [21_600, { kind: 'call.recorded', call: calls.cand1 }],
    [120, { kind: 'candidate.proposed', candidate: proposed(1, 1, CANDIDATE_OFF_BY_ONE, 4) }],
    ...stageEvents(1, CAND1_STAGES),
    [
      60,
      {
        kind: 'candidate.decided',
        candidateId: 1,
        outcome: 'rejected',
        tier: null,
        rejection: {
          stage: 'smt',
          kind: 'smt-counterexample',
          reason: 'For n = 2 the candidate returns 2, the original returns 1: the early return `n <= 2` should stop at n <= 1.',
          counterexample: { input: [2], original: { tag: 'ok', value: 1 }, candidate: { tag: 'ok', value: 2 }, source: 'smt' },
        },
        // Rejected before the benchmark stage: the server does not benchmark it.
        bench: null,
        speedup: null,
      },
    ],
    [19_900, { kind: 'call.recorded', call: calls.cand2 }],
    [110, { kind: 'candidate.proposed', candidate: proposed(2, 1, CANDIDATE_ITERATIVE, 5) }],
    ...stageEvents(2, CAND2_STAGES.slice(0, 4)),
    [24_800, { kind: 'call.recorded', call: candProofCalls.c2a1 }],
    [31_500, { kind: 'call.recorded', call: candProofCalls.c2a2 }],
    ...stageEvents(2, CAND2_STAGES.slice(4, 5)),
    [1_650, { kind: 'model.checked', check: { subject: 'candidate', candidateId: 2, inputs: 1000, disagreements: 0, seed: 424242, ms: 1_650 } }],
    ...stageEvents(2, CAND2_STAGES.slice(5)),
    [
      70,
      {
        kind: 'candidate.decided',
        candidateId: 2,
        outcome: 'incumbent',
        tier: 'proved',
        rejection: null,
        bench: { median: 14.6, lo: 14.1, hi: 15.2, unit: 'ns/pass', trials: 30, distribution: DISTRIBUTION, sizes: [] },
        speedup: { ratio: 4.21, lo: 3.93, hi: 4.58, significant: true },
      },
    ],
    [20, { kind: 'incumbent.changed', candidateId: 2 }],
    [26_400, { kind: 'call.recorded', call: calls.cand3 }],
    [130, { kind: 'candidate.proposed', candidate: proposed(3, 2, CANDIDATE_TWO_STEP, 6) }],
    ...stageEvents(3, CAND3_STAGES.slice(0, 4)),
    [33_000, { kind: 'call.recorded', call: candProofCalls.c3a1 }],
    [41_700, { kind: 'call.recorded', call: candProofCalls.c3a2 }],
    [47_200, { kind: 'call.recorded', call: candProofCalls.c3a3 }],
    ...stageEvents(3, CAND3_STAGES.slice(4)),
    [
      80,
      {
        kind: 'candidate.decided',
        candidateId: 3,
        outcome: 'faster-not-proved',
        tier: 'verified-to-k',
        rejection: CAND3_REJECTION,
        bench: { median: 12.0, lo: 11.6, hi: 12.5, unit: 'ns/pass', trials: 30, distribution: DISTRIBUTION, sizes: [] },
        speedup: { ratio: 5.12, lo: 4.79, hi: 5.43, significant: true },
      },
    ],
    [400, { kind: 'optimize.stopped', reason: 'threshold' }],
    [
      38_000,
      {
        kind: 'deliver.done',
        dir: '.faithful/fib',
        files: ['fib.lean', 'patch.diff', 'spec.md', 'fib.provenance.json', 'VERIFY.md'],
        at: at(560_000),
      },
    ],
  ]),
};
