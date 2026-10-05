// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":3}
// Round 2, filterI vs slice with the start clamped at 0 (and a drop-prefix variant).
export function original(xs: number[], k: number): number[] {
  return xs.filter((x, i) => i < k).concat(xs.filter((x, i) => i >= k + 1));
}
export function candidate(xs: number[], k: number): number[] {
  return xs.slice(0, Math.max(k, 0)).concat(xs.slice(Math.max(k + 1, 0)));
}
