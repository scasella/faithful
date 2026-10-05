// @redteam area=arithmetic status=divergence input=[3] ts=excluded-by-int-bound-ts lean=ok:6,pre=true expect=ok round=3 root-cause=emit.ts-tsPred-unhygienic severity=completeness:harness
// The int-bound precondition's `ts` expression is `(Number.isInteger(Math) && Math.abs(Math) <= 9007199254740992)`,
// evaluated by compilePreconditions (engine generate.ts) with the parameters bound by name: here `Math` is the number 3,
// `Math.abs` is undefined, the predicate throws and counts as false. Every input is rejected, so tsVsLean compares
// nothing (underPreconditions 0) while Lean's `Model.r3ParamMath_pre 3 = true` and the model returns 6.
// @inputs [[3],[-5],[9007199254740992]]
// @tags ["ok","ok","range-violation"]
export function r3ParamMath(Math: number): number {
  return Math * 2;
}
