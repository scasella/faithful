// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// (xs ++ ys).slice(xs.length) is ys.
export function original(xs: number[], ys: number[]): number[] {
  return xs.concat(ys).slice(xs.length);
}
export function candidate(xs: number[], ys: number[]): number[] {
  return ys.slice(0);
}
