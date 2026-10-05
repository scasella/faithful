// @redteam area=arithmetic status=divergence input=[[1,2]] ts=excluded-by-int-bound-ts lean=ok:2,pre=true expect=ok round=3 root-cause=emit.ts-tsPred-unhygienic severity=completeness:harness
// Same root cause through `Number`: the predicate is `Number.every((e0) => (Number.isInteger(e0) && ...))`; inside the
// callback `Number` is the array parameter, so `Number.isInteger` throws for any non-empty array. Only [] is accepted.
// @inputs [[[1,2]],[[]],[[-9007199254740992,5]]]
// @tags ["ok","ok","ok"]
export function r3ParamNumber(Number: number[]): number {
  return Number.length;
}
