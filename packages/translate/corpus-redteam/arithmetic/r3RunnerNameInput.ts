// @redteam area=arithmetic status=divergence input=[10] ts=ok:30 runner=fault:not-a-function lean=ok:30 expect=ok round=3 root-cause=instrument.ts-buildInstrumentedRunner-unhygienic severity=low:test-harness
// buildInstrumentedRunner: `let input` (the JSON-copied arguments) shadows the function `input`; `input(...input)` is a
// TypeError, reported as `fault`.
// @inputs [[10],[-3]]
export function input(a: number): number {
  return a * 3;
}
