export {
  generateInputs,
  compilePreconditions,
  boundaryValues,
  mulberry32,
  Rng,
  INT_BOUNDARIES,
  SURROGATE_CASES,
  type GenOptions,
  type GeneratedInputs,
  type CompiledPrecondition,
} from './generate.js';
export { sandboxRuntime, instrumentedSandboxSource, INSTRUMENTED_ENTRY } from './instrumented.js';
export {
  tsVsLean,
  tsVsTs,
  valEqual,
  outcomeEqual,
  type LeanEvaluator,
  type LeanEvalResult,
  type TsVsLeanOptions,
  type TsVsLeanDeps,
  type TsVsLeanReport,
  type Disagreement,
  type DisagreementKind,
  type TsProgram,
  type TsVsTsDeps,
  type TsVsTsReport,
  type TsVsTsCandidateReport,
} from './differential.js';
export { loadCorpus, parseCorpusHeader, CORPUS_CLASSES, KNOWN_TRANSLATOR_GAPS, type CorpusEntry, type CorpusHeader } from './corpus.js';
