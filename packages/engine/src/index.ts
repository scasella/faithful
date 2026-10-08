export {
  Sandbox,
  liveSandboxWorkers,
  type SandboxOptions,
  type LoadOptions,
  type LoadResult,
  type BatchOptions,
  type BatchResult,
  type PurityReport,
  type CallResult,
} from './sandbox/sandbox.js';
export {
  FaithfulRangeViolation,
  isFaithfulRangeViolation,
  INSTRUMENT_NAMES,
  TRAPPED,
  type PurityViolation,
  type ViolationKind,
} from './sandbox/mask.js';
export { prepareSource, type PreparedSource, type SourceProblem } from './sandbox/source.js';
export { extractUnit, type ExtractResult, type IncludedDecl, type IncludedKind } from './sandbox/extract.js';
export {
  compileGate,
  canonicalType,
  COMPILE_OPTIONS,
  type CompileDiagnostic,
  type CompileGateInput,
  type CompileGateResult,
  type Signature,
} from './gates/compile.js';
export { purityGate, type PurityGateInput, type PurityGateResult } from './gates/purity.js';
export {
  mutationCheck,
  summarize as summarizeMutants,
  canonicalJson,
  DEFAULT_MAX_MUTANTS,
  DEFAULT_SECOND_PASS_INPUTS,
  type MutationOptions,
  type MutationReport,
  type MutantFate,
  type MutantResult,
} from './mutation/check.js';
export { generateMutants, enumerateCandidates, MUTATION_KINDS, type Mutant, type MutationKind, type GeneratedMutants } from './mutation/mutate.js';
export { deriveInputs, paramTys } from './mutation/inputs.js';
export {
  bench,
  compare,
  sweep,
  type Distribution,
  type BenchOptions,
  type BenchReport,
  type CompareReport,
  type SizeResult,
  type Speedup,
  type SweepReport,
  type FnRef,
} from './benchmark/bench.js';
export {
  bootstrapMedian,
  bootstrapRatio,
  bootstrapLogLogSlope,
  median,
  percentile,
  verdict,
  MIN_RESAMPLES,
  type Interval,
  type Verdict,
} from './benchmark/stats.js';
export type { Rng as BenchRng } from './benchmark/rng.js';
export {
  buildEvidenceBlock,
  buildEvidenceLine,
  lintEvidenceText,
  leanVersionOf,
  mathlibShortOf,
  type EvidenceInput,
  type EvidenceBlock,
} from './evidence/evidence.js';
export {
  stamped,
  type Stamped,
  type StampedMutationReport,
  type StampedBenchReport,
  type StampedCompareReport,
  type StampedSweepReport,
  type StampedEvidence,
} from './evidence/provenance.js';
export * from './differential/index.js';
