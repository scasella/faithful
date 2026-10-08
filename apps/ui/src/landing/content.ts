/**
 * Everything the landing page states as a recorded fact. Nothing here is invented: each value names its source, a
 * recording under apps/showcase/public/recordings/ (event kind, candidate) or a section of docs/LAUNCH.md, and
 * content.test.ts reads those files and checks the values against them, so a recording or report that changes fails the
 * test instead of leaving the page stale.
 *
 * Prose (what a gate does, what a label means) follows docs/DESIGN.md, docs/TIERS.md and README.md; it carries no
 * measured numbers.
 */
import type { Outcome, Val } from '@faithful/translate';
import type { Tier } from '@faithful/core/tiers';

/** One line of a code pane; `removed` lines are shown struck through (they exist in the original, not in the rewrite). */
export interface CodeLine {
  text: string;
  removed?: boolean;
}

/** The Z3 catch: apps/showcase/public/recordings/clamp.json, candidate 2. */
export const CATCH = {
  fn: 'clamp',
  /** candidate.proposed: the session proposed 2 candidates; this is the second. */
  candidateId: 2,
  candidateCount: 2,
  /** session.started.source / rec.source: the function as pasted (without its corpus header comments). */
  original: [
    'export function clamp(value: number, lo: number, hi: number): number {',
    '  if (lo > hi) {',
    '    throw new Error("clamp: lower bound exceeds upper bound");',
    '  }',
    '  return Math.min(Math.max(value, lo), hi);',
    '}',
  ],
  /**
   * candidate.proposed (id 2).source, line by line, with the original's lo > hi check (which the rewrite dropped)
   * inserted where it was and marked removed.
   */
  rewrite: [
    { text: 'export function clamp(value: number, lo: number, hi: number): number {' },
    { text: '  if (lo > hi) {', removed: true },
    { text: '    throw new Error("clamp: lower bound exceeds upper bound");', removed: true },
    { text: '  }', removed: true },
    { text: '  if (value < lo) return lo;' },
    { text: '  if (value > hi) return hi;' },
    { text: '  return value;' },
    { text: '}' },
  ] as CodeLine[],
  /** stage.result (candidate 2, differential).detail.compared */
  compared: 1000,
  /** stage.result (candidate 2, compile / purity / differential).status: all "pass" */
  passed: ['compile', 'purity', 'differential'],
  /** stage.result (candidate 2, differential).summary, verbatim */
  differential: '1000 inputs, no difference; 7 of 7 broken copies of the original caught',
  /** stage.result (candidate 2, smt).summary, verbatim; detail.result "sat" */
  smt: 'Z3 found an input where the candidate differs (arrays up to k=2)',
  smtResult: 'sat',
  /** candidate.decided (candidate 2).rejection.counterexample.input; parameter names from the signature */
  input: [-2, -1, -3] as Val[],
  params: ['value', 'lo', 'hi'],
  /** candidate.decided (candidate 2).rejection.counterexample.original */
  originalOutcome: { tag: 'throw', message: 'clamp: lower bound exceeds upper bound' } as Outcome,
  /** candidate.decided (candidate 2).rejection.counterexample.candidate */
  candidateOutcome: { tag: 'ok', value: -1 } as Outcome,
  /** candidate.decided (candidate 2).outcome */
  outcome: 'rejected',
  /** proof.done (original_meets_spec).result "proved"; deliver.done follows with no incumbent candidate */
  originalProved: true,
} as const;

/** The six gates, with the numbers of apps/showcase/public/recordings/fibRecursive.json, candidate 1. */
export const FIB = {
  fn: 'fibRecursive',
  candidateId: 1,
  /** stage.result (candidate 1, compile).ms = 55.05… */
  compileMs: 55.05812500003958,
  /** stage.result (candidate 1, purity).ms = 6.05… */
  purityMs: 6.059249999991152,
  /** stage.result (candidate 1, differential).detail: compared, skippedSlow, mutation.caught / mutation.total */
  compared: 526,
  skippedSlow: 66,
  mutantsCaught: 12,
  mutantsTotal: 12,
  /** stage.result (candidate 1, differential).summary, verbatim */
  differential: '526 inputs, no difference (66 inputs skipped: the original takes more than 100 ms); 12 of 12 broken copies of the original caught',
  /** stage.result (candidate 1, smt).detail.k and .result; the summary narrows the claim (verbatim clause below) */
  k: 6,
  smtResult: 'unsat',
  narrowed: 'integers in [-8, 8]',
  /** stage.result (candidate 1, benchmark).summary, verbatim; detail.trials, .distribution and .sizes */
  benchmark: 'faster than the original: 61991× (95% CI 60646–62858)',
  trials: 31,
  distribution: 'auto: n: integer in [0, n]',
  /** The n the distribution was drawn at: the exponential-vs-linear gap, and so the ratio, depends on them. */
  sizes: [8, 16, 32],
  /** candidate.decided (candidate 1).speedup */
  speedup: { ratio: 61991.0420568694, lo: 60646.6587850071, hi: 62857.18320260889, significant: true },
  /** stage.result (candidate 1, proof).summary, verbatim; detail.attempts */
  proof: 'Not proved (8 attempts, 8.2 minutes; the equality part was proved, the range part was not)',
  proofAttempts: 8,
  /** candidate.decided (candidate 1).tier and .outcome */
  tier: 'verified-to-k' as Tier,
  outcome: 'faster-not-proved',
} as const;

/** The original's model check of clamp.json (model.checked, subject "original").inputs: N in its provedSentence(N). */
export const CLAMP_MODEL_CHECK_N = 1000;

/** docs/LAUNCH.md section 16, "Optimization candidates" table: "| faster, not proved | 72 of 130 |". */
export const FASTER_NOT_PROVED = '72 of 130';

export interface Measured {
  value: string;
  label: string;
  /** Drawn in the catch colour: the unflattering one. */
  catchTone?: boolean;
}

/** "What we measured": counts from docs/LAUNCH.md (content.test.ts checks each against the file). */
export const MEASURED: Measured[] = [
  // docs/LAUNCH.md section 3 "Subset coverage", Corpus: "39 of 74 are in the subset".
  { value: '39 of 74', label: 'corpus functions inside the translator’s subset' },
  // docs/LAUNCH.md section 3 "Subset coverage", Library sample: "0 of 20 are in the subset".
  { value: '0 of 20', label: 'functions sampled from real libraries inside the subset', catchTone: true },
  // docs/LAUNCH.md section 16, "Proving the original function", table "Campaign (shipped defaults)": "| **total** | 20 of 39 |".
  { value: '20 of 39', label: 'originals with an accepted Lean proof against an agreed spec (campaign, shipped defaults)' },
  // docs/LAUNCH.md section 16, "Optimization candidates": "| incumbent (accepted, best so far) | 3 of 130 |"; "Speedups": "| best | 1.6x | 1.6-1.8 | numeric/sign | proved |".
  { value: '3 of 130', label: 'candidates both proved and faster; best 1.6× (95% CI 1.6–1.8)' },
];

/** docs/LAUNCH.md, "Campaign caveats": the large wins ("26× for an aliquot sum, 60,000× for iterative Fibonacci") and the shared machine. */
export const MEASURED_NOTE =
  'The model’s big wins (26× for an aliquot sum, 60,000× for iterative Fibonacci) used constructs the translator refuses, or loops whose range obligation Lean did not close. Benchmarks ran on a shared machine; small speedups should be re-measured.';

/** What each label means, strongest first (docs/TIERS.md, "The five labels"). Keys are the tiers of @faithful/core. */
export const TIER_MEANING: Record<Tier, string> = {
  proved:
    'Lean 4 accepted a theorem Faithful wrote, relating the Lean model of the function to the agreed spec, using only the standard axioms.',
  'proved-trusting-compiler': 'Lean accepted the theorem, but the proof uses native_decide, so Lean’s compiler and runtime are in the trusted base.',
  'verified-to-k': 'Z3 found no input within the stated bounds where the candidate differs from the original.',
  tested: 'Passed compile, purity and the differential test on the generated inputs, and nothing stronger.',
  'not-proved': 'No accepted proof exists. A failed proof shows neither that the function nor that the spec is wrong.',
};

/**
 * The toolchain the recordings were made with: clamp.json `toolchain` (lean.toolchain "leanprover/lean4:v4.34.0",
 * lean.mathlibCommit 5ed2965…, z3 { kind: "wasm", version: "5.2.0" }, codex { model: "gpt-6-luna", version:
 * "codex-cli 0.159.2" }).
 */
export const TOOLCHAIN_STAMP = ['Lean 4.34.0 · Mathlib 5ed2965', 'z3-solver 5.2.0 (WASM)', 'model gpt-6-luna via Codex CLI 0.159.2', 'MIT'];

/** README.md, "Usage": the headless commands (`faithful` = node packages/cli/dist/bin.js). An example file path. */
export const COMMANDS = ['faithful doctor', 'faithful optimize src/math.ts --fn clamp', 'faithful verify .faithful/clamp'];

/** README.md, "Install". */
export const REQUIREMENTS = 'Needs Node 22.12 or later, pnpm, the Codex CLI, and about 7 GB of disk for the Lean/Mathlib cache.';
