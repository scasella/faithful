// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2} adv=[[[9007199254740992,-9007199254740992,0]],[[-1,-12,345]],[[]]]
// Round 2, join/split counting written correctly: one part per element plus one per minus sign, and [""] for [].
export function original(xs: number[]): number {
  return xs.join("-").split("-").length;
}
export function candidate(xs: number[]): number {
  if (xs.length === 0) {
    return 1;
  }
  return xs.length + xs.filter((x) => x < 0).length;
}
