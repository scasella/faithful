// @redteam area=arithmetic status=divergence input=[134217728] ts=fault lean=rangeOk=false expect=ok round=3 root-cause=engine-instrumented.ts-sandboxRuntime-unhygienic severity=completeness:harness
// The sandbox's instrumented source declares `class RangeViolation extends FaithfulRangeViolation` (engine
// differential/instrumented.ts) in the same block as the user's function. A function named `FaithfulRangeViolation`
// is what that `extends` resolves to, so every failed range check runs the user function on the detail string
// (BigInt("range check failed ...") throws SyntaxError) and the sandbox reports `fault`, not `range-violation`.
// tsVsLean then drops the input as a TS fault instead of cross-checking Lean's rangeOk = false. No false claim, but
// the range-ok side of the differential is silently skipped for this name. (buildInstrumentedRunner is unaffected.)
// @inputs [[134217728],[3],[-94906266]]
// @tags ["range-violation","ok","range-violation"]
export function FaithfulRangeViolation(a: number): number {
  return a * a;
}
