// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// Round 2, option of an array: null vs [] are different results.
export function original(xs: number[]): number[] | null {
  return xs.length > 0 ? xs.slice(1) : null;
}
export function candidate(xs: number[]): number[] | null {
  return xs.slice(1);
}
