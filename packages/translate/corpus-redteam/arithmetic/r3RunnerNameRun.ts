// @redteam area=arithmetic status=divergence input=[10] ts=ok:3 runner=ok:{tag:fault} lean=ok:3 expect=ok round=3 root-cause=instrument.ts-buildInstrumentedRunner-unhygienic severity=low:test-harness
// buildInstrumentedRunner (translate/src/instrument.ts) wraps the function in `return function run(args) { ... const value
// = ${fnName}(...input) ... }`. For a function named `run` the call resolves to the runner itself: run(10) -> run(...10)
// throws, the inner runner returns a fault Outcome, and the outer one reports {tag:'ok', value:{tag:'fault',...}}: a
// wrong `ok` outcome. tsVsLean (sandbox path, evalMasked) is not affected; the translator's own tests and this file
// use buildInstrumentedRunner. Same family: r3RunnerNameValue (`value`, TDZ) and `input` (shadowed by `let input`).
// @inputs [[10],[-10]]
export function run(a: number): number {
  return a % 7;
}
