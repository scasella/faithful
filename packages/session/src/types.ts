/**
 * The session: what the user and the tool have established so far about one function. Event-sourced: flows append
 * `SessionEvent`s, `reduce` derives `SessionState`, and the same events drive (a) the live UI, (b) `.faithful/<fn>/`
 * persistence, (c) provenance.json and (d) showcase recordings that replay in the browser. All types are plain JSON.
 *
 * Claims use the exact tier vocabulary of @faithful/core (`Tier`). Nothing here is a score.
 */
import type { Stamp, Tier, ToolchainSnapshot } from '@faithful/core';
import type { Outcome, Precondition, Refusal, Translation, Ty, Val } from '@faithful/translate';

// ───────────── model calls ("What the model saw") ─────────────

export interface CallRecord {
  /** Monotonic id within the session. */
  id: number;
  purpose: 'spec-proposal' | 'spec-revision' | 'proof-attempt' | 'candidate';
  /** Verbatim prompt sent to Codex. */
  prompt: string;
  /** Verbatim final message from the model (null on error). */
  response: string | null;
  model: string;
  effort: string;
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  startedAt: string;
}

// ───────────── spec agreement ─────────────

export interface SpecLine {
  lean: string;
  english: string;
}

export interface SpecProperty {
  name: string;
  /** Non-executable Lean proposition (a `Prop` definition). */
  lean: string;
  english: string;
}

export interface SpecProposal {
  id: number;
  /** `proposal` for the first, `revision` when produced after a "the spec is wrong" ruling. */
  kind: 'proposal' | 'revision';
  /** Executable Lean `def Spec.spec ...` text (no imports). */
  lean: string;
  lines: SpecLine[];
  properties: SpecProperty[];
  english: string;
  callId: number;
  /** Did the spec type-check against the model and run? */
  validation: { ok: true; hash: string } | { ok: false; errors: string[] };
}

export interface Challenge {
  id: string;
  input: Val[];
  spec: Outcome;
  original: Outcome;
  /** Which inputs produced it, for display: 'boundary' (translator-known edge case) or 'random'. */
  origin: 'boundary' | 'random';
}

export interface ChallengeRun {
  id: number;
  specHash: string;
  inputsTried: number;
  /** Inputs that satisfied the preconditions and were compared. */
  inputsCompared: number;
  /** Listed disagreements (capped); `totalDisagreements` is the full count. */
  disagreements: Challenge[];
  totalDisagreements?: number;
  /** Ids of the carve-outs this search ran under (the search is only current for the current carve-outs). */
  carveOutIds?: string[];
  /** Inputs not compared, by reason. */
  excluded?: { range: number; throwPrecondition: number; faults: number; carvedOut: number };
  ms: number;
  seed: number;
}

export type Ruling =
  | { challengeId: string; specHash: string; ruling: 'spec-wrong'; note?: string }
  | {
      challengeId: string;
      specHash: string;
      ruling: 'function-wrong';
      /** After "my function is wrong": fix the original (stop; the user edits their file) or carve the class out. */
      then: 'fix-original' | 'carve-out';
      carveOut?: Precondition;
      note?: string;
    };

export interface Agreement {
  specHash: string;
  specLean: string;
  english: string;
  preconditions: Precondition[];
  /** Carve-outs, shown prominently forever. */
  carveOuts: Precondition[];
  rulings: Ruling[];
  throwChoice: 'precondition' | 'spec-case' | null;
  /** Hash over spec + preconditions + carve-outs + rulings: everything downstream pins to this. */
  hash: string;
  at: string;
}

// ───────────── proofs ─────────────

export interface ProofAttemptView {
  n: number;
  callId: number | null;
  helpers: string;
  proof: string;
  verdict: 'proved' | 'proved-trusting-compiler' | 'failed' | 'rejected';
  failureReason?: string;
  diagnostics: Array<{ line: number; column: number; message: string; goal?: string }>;
  ms: number;
}

export interface ProofView {
  theoremId: string;
  /** What is being proved, in Lean and words. */
  statement: string;
  statementWords: string;
  pinnedTo: string; // agreement hash
  attempts: ProofAttemptView[];
  result: 'proved' | 'proved-trusting-compiler' | 'not-proved' | 'running';
  accepted: { helpers: string; proof: string; source: string; axioms: string[] } | null;
  ms: number;
  /** Exact failure wording, e.g. "Not proved (3 attempts, 4.2 minutes)". */
  failureLine?: string;
  stoppedBy?: string;
  /** The budget the user chose for this run (attempts and minutes at most). Absent in older recordings. */
  budget?: { maxAttempts: number; minutes: number };
  /**
   * Candidate proofs proved in two parts (docs/PROOFS.md, "Candidate proofs"): a part (`candidate_<id>_equals_spec`,
   * `candidate_<id>_range_ok`) names the theorem it is a part of; the combined theorem (`candidate_<id>_meets_spec`)
   * lists its parts. Only the combined theorem's result is a claim; a proved part alone changes no tier.
   */
  parent?: string;
  parts?: string[];
}

// ───────────── optimization ─────────────

export type StageId = 'compile' | 'purity' | 'differential' | 'smt' | 'proof' | 'benchmark';
export const STAGE_ORDER: StageId[] = ['compile', 'purity', 'differential', 'smt', 'proof', 'benchmark'];

export type StageStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skipped';

export interface StageResult {
  stage: StageId;
  status: StageStatus;
  ms: number;
  /** Plain-words one-liner: "1,000 inputs, no difference", "counterexample found", "Verified to k=6". */
  summary: string;
  detail?: Record<string, unknown>;
}

/** Why a candidate was rejected, in the form the hero card shows. */
export interface Rejection {
  stage: StageId;
  kind: 'compile-error' | 'impure' | 'counterexample' | 'proof-failed' | 'smt-counterexample' | 'not-faster' | 'other';
  /** Plain-words reason a developer can read in five seconds. */
  reason: string;
  counterexample?: { input: Val[]; original: Outcome; candidate: Outcome; source: 'differential' | 'smt' };
  /** Lean goal state or error for proof failures. */
  goal?: string;
  theorem?: string;
}

export interface BenchSummary {
  median: number;
  /** 95% bootstrap CI, in the same unit. */
  lo: number;
  hi: number;
  unit: 'ns/pass';
  trials: number;
  distribution: string;
  sizes: number[];
  /** Raw per-trial pass times in ms (kept so a reviewer can recompute the interval). */
  samples?: number[];
}

export interface Speedup {
  ratio: number;
  lo: number;
  hi: number;
  /** Non-overlapping intervals between candidate and incumbent. */
  significant: boolean;
}

export interface CandidateRecord {
  id: number;
  round: number;
  source: string;
  callId: number | null;
  stages: StageResult[];
  rejection: Rejection | null;
  /** Highest tier reached by this candidate against the agreed spec. */
  tier: Tier | null;
  outcome: 'running' | 'incumbent' | 'faster-not-proved' | 'accepted-at-verified' | 'rejected' | 'not-faster';
  bench: BenchSummary | null;
  /** Versus the ORIGINAL on the declared distribution. */
  speedup: Speedup | null;
}

export type Threshold =
  | { kind: 'time-budget'; minutes: number }
  | { kind: 'speedup'; target: number; distribution: string }
  | { kind: 'asymptotic'; sizes: number[] };

export interface OptimizeState {
  threshold: Threshold | null;
  baseline: BenchSummary | null;
  candidates: CandidateRecord[];
  incumbentId: number | null;
  stoppedBy: 'threshold' | 'budget' | 'no-new-candidate' | 'round-limit' | 'user' | null;
  startedAt: string | null;
}

/** The Lean model of a function was compared with its TypeScript on N generated inputs (the N in "Proved ... checked against the TypeScript on N inputs"). */
export interface ModelCheck {
  subject: 'original' | 'candidate';
  candidateId: number | null;
  /** Inputs on which TypeScript and the Lean model agreed under the preconditions. */
  inputs: number;
  disagreements: number;
  seed: number;
  ms: number;
}

// ───────────── the Tested-only path (functions the translator refused) ─────────────

/**
 * Recorded when the user continues with a function the translator refused: no Lean model, no spec, no agreement, no
 * proof and no SMT check exist for it. Candidates are checked against the ORIGINAL only (differential on inputs
 * generated from the TypeScript signature, the mutation check, the benchmark); the highest tier is Tested.
 */
export interface TestedOnly {
  /** The translator's refusal, kept verbatim (code, plain-words reason, exact span). */
  refusal: Refusal;
  /** The parameter types inputs are generated from, in words: `average(xs: array of number)`. */
  signature: string;
  /** The user opted in to NaN, Infinity, -Infinity and -0 as generated inputs. */
  specials: boolean;
  at: string;
}

// ───────────── the state ─────────────

export type StageName = 'select' | 'translate' | 'agree' | 'prove' | 'optimize' | 'deliver';

export interface SessionState {
  schema: 1;
  fn: string;
  /** Path relative to the repo root; empty for pasted code. */
  file: string;
  source: string;
  sourceHash: string;
  toolchain: ToolchainSnapshot | null;
  stage: StageName;
  translation: { ok: true; value: Translation } | { ok: false; refusal: Refusal } | null;
  throwChoice: 'precondition' | 'spec-case' | null;
  calls: CallRecord[];
  proposals: SpecProposal[];
  challengeRuns: ChallengeRun[];
  rulings: Ruling[];
  carveOuts: Precondition[];
  agreement: Agreement | null;
  /** Reasons earlier agreements were invalidated (kept; never silently dropped). */
  invalidations: Array<{ at: string; reason: string; previousHash: string }>;
  proofs: ProofView[];
  modelChecks: ModelCheck[];
  optimize: OptimizeState;
  delivery: { dir: string; files: string[]; at: string } | null;
  /** The job (model call, proof, optimization...) currently running, and the last failure. Failures are never silent. */
  job: { running: string | null; lastError: { job: string; message: string } | null };
  stamp: Stamp | null;
  /** Set once the user chose the Tested-only path for a refused function (absent otherwise, and in older recordings). */
  tested?: TestedOnly | null;
}

// ───────────── events ─────────────

export type SessionEvent =
  | { kind: 'session.started'; fn: string; file: string; source: string; sourceHash: string; toolchain: ToolchainSnapshot }
  | { kind: 'translate.done'; result: { ok: true; value: Translation } | { ok: false; refusal: Refusal } }
  | { kind: 'throw.choice'; choice: 'precondition' | 'spec-case' }
  | { kind: 'call.recorded'; call: CallRecord }
  | { kind: 'spec.proposed'; proposal: SpecProposal }
  | { kind: 'challenge.run'; run: ChallengeRun }
  | { kind: 'ruling.made'; ruling: Ruling }
  | { kind: 'spec.agreed'; agreement: Agreement }
  | { kind: 'spec.invalidated'; reason: string; at: string }
  | { kind: 'proof.started'; proof: ProofView }
  | { kind: 'proof.attempt'; theoremId: string; attempt: ProofAttemptView }
  | { kind: 'proof.done'; theoremId: string; result: ProofView['result']; accepted: ProofView['accepted']; ms: number; failureLine?: string; stoppedBy?: string }
  | { kind: 'model.checked'; check: ModelCheck }
  | { kind: 'optimize.started'; threshold: Threshold; baseline: BenchSummary | null; at: string }
  | { kind: 'candidate.proposed'; candidate: CandidateRecord }
  | { kind: 'stage.result'; candidateId: number; result: StageResult }
  | { kind: 'candidate.decided'; candidateId: number; outcome: CandidateRecord['outcome']; tier: Tier | null; rejection: Rejection | null; bench: BenchSummary | null; speedup: Speedup | null }
  | { kind: 'incumbent.changed'; candidateId: number | null }
  | { kind: 'optimize.stopped'; reason: NonNullable<OptimizeState['stoppedBy']> }
  | { kind: 'job.started'; job: string }
  | { kind: 'job.finished'; job: string }
  | { kind: 'job.failed'; job: string; message: string }
  | { kind: 'deliver.done'; dir: string; files: string[]; at: string }
  /** The user continues a refused function on the Tested tier only (then `optimize.started` etc. as usual). */
  | { kind: 'tested.started'; refusal: Refusal; signature: string; specials: boolean; at: string };

/** An event as stored/streamed: monotonically numbered, timestamped (ms since session start). */
export interface StampedEvent {
  seq: number;
  /** ms since the first event; replays pace themselves with it. */
  t: number;
  event: SessionEvent;
}

export type { Ty };
