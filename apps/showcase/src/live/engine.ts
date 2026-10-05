/**
 * What `@faithful/engine` means inside the showcase: the browser-safe parts of packages/engine/src, by source path,
 * plus the browser sandbox under the engine's own name `Sandbox`. (The engine's index also exports the benchmark,
 * mutation tester, corpus loader and evidence builder, which the showcase does not run live.)
 */
export { Sandbox, liveSandboxWorkers, type CallResult, type BatchOptions, type BatchResult, type LoadResult, type PurityReport } from './browserSandbox';
export { generateInputs, compilePreconditions, type GenOptions, type GeneratedInputs } from '@faithful-engine-src/differential/generate.ts';
export { sandboxRuntime, instrumentedSandboxSource, INSTRUMENTED_ENTRY } from '@faithful-engine-src/differential/instrumented.ts';
export { tsVsTs, valEqual, outcomeEqual, type TsVsTsReport, type TsProgram } from '@faithful-engine-src/differential/differential.ts';
export { compileGate, type CompileGateResult } from '@faithful-engine-src/gates/compile.ts';
export { purityGate, type PurityGateResult } from '@faithful-engine-src/gates/purity.ts';
