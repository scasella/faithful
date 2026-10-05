// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":4} adv=[[[1,2,3,4,5,6],-9007199254740992],[[1,2,3,4,5,6],9007199254740992],[[],-1]]
// Round 3: xs.slice(0, i).concat(xs.slice(i)) is xs for every i, negative and out of range included.
export function original(xs: number[], i: number): number[] {
  return xs.slice(0, i).concat(xs.slice(i));
}
export function candidate(xs: number[], i: number): number[] {
  return xs.map((x) => x);
}
