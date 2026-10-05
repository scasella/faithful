// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":2} adv=[[[9007199254740992,-9007199254740992]],[[-1]],[[]],[[0,-0]]]
// Round 2, join of numbers then split on "-": the count differs from the length at [] ("".split gives [""]) and at
// any negative element (its minus sign is a separator). intToStr + literal-separator split + join.
export function original(xs: number[]): number {
  return xs.join("-").split("-").length;
}
export function candidate(xs: number[]): number {
  return xs.length;
}
