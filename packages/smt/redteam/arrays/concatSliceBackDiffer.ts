// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1}
// (xs ++ ys).slice(ys.length) is xs only when the lengths agree.
export function original(xs: number[], ys: number[]): number[] {
  return xs.concat(ys).slice(ys.length);
}
export function candidate(xs: number[], ys: number[]): number[] {
  return xs;
}
