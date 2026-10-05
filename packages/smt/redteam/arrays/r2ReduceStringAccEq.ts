// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2} adv=[[[9007199254740992,-9007199254740992,-1]],[[10,-100,1000]]]
// Round 2, reduce with a string accumulator (intToStr in a template) vs join("").
export function original(xs: number[]): string {
  return xs.reduce((a, x) => `${a}${x}`, "");
}
export function candidate(xs: number[]): string {
  return xs.join("");
}
