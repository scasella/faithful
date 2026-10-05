// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":3}
// Round 2, filterI vs slice: filter((x, i) => i < k) is [] for k <= 0, slice(0, k) counts a negative k from the end.
export function original(xs: number[], k: number): number[] {
  return xs.filter((x, i) => i < k);
}
export function candidate(xs: number[], k: number): number[] {
  return xs.slice(0, k);
}
