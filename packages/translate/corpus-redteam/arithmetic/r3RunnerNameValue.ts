// @redteam area=arithmetic status=divergence input=[10] ts=ok:5 runner=fault:TDZ lean=ok:5 expect=ok round=3 root-cause=instrument.ts-buildInstrumentedRunner-unhygienic severity=low:test-harness
// buildInstrumentedRunner: `const value = value(...input)` reads the runner's own `value` in its TDZ, so every call is a
// `fault` (ReferenceError) instead of ok 5. A function named `input` fails the same way (`let input` shadows it).
// @inputs [[10],[-9]]
export function value(a: number): number {
  return Math.floor(a / 2);
}
