// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":3} adv=[[[1,2,3,4,5,6],-9007199254740992],[[1,2,3,4,5,6],9007199254740991],[[7],-1]]
// Round 3: "remove index i" by slicing differs from filterI(j !== i) only for negative i (slice counts from the end).
export function original(xs: number[], i: number): number[] {
  return xs.slice(0, i).concat(xs.slice(i + 1));
}
export function candidate(xs: number[], i: number): number[] {
  return xs.filter((x, j) => j !== i);
}
