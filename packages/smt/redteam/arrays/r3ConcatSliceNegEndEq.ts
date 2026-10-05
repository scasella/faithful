// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1} adv=[[[1,2,3,4,5,6],[7]],[[],[]],[[1],[2,3,4,5,6]]]
// Round 3: the last two elements of xs ++ ys, by slice(-2) on the concatenation vs computed per side.
export function original(xs: number[], ys: number[]): number[] {
  return xs.concat(ys).slice(-2);
}
export function candidate(xs: number[], ys: number[]): number[] {
  if (ys.length >= 2) return ys.slice(ys.length - 2);
  return xs.slice(Math.max(0, xs.length - (2 - ys.length))).concat(ys);
}
