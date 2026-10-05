// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":3} adv=[[[1,2,3,4,5,6],-9007199254740992],[[1,2,3,4,5,6],5],[[7],-1]]
// Round 3: with negative i handled first, slicing out index i equals filterI(j !== i).
export function original(xs: number[], i: number): number[] {
  if (i < 0) return xs;
  return xs.slice(0, i).concat(xs.slice(i + 1));
}
export function candidate(xs: number[], i: number): number[] {
  return xs.filter((x, j) => j !== i);
}
