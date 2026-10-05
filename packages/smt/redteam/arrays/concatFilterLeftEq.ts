// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// concat with a left operand of symbolic length (a filter result): seq.ts concat general path; filterI.
export function original(xs: number[], ys: number[]): number[] {
  return xs.filter((x) => x > 0).concat(ys);
}
export function candidate(xs: number[], ys: number[]): number[] {
  return xs.concat(ys).filter((x, i) => i >= xs.length || x > 0);
}
