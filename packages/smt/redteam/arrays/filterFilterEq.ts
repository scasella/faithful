// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// filter of filter against one filter with &&.
export function original(xs: number[]): number[] {
  return xs.filter((x) => x > -2).filter((x) => x < 2);
}
export function candidate(xs: number[]): number[] {
  return xs.filter((x) => x > -2 && x < 2);
}
