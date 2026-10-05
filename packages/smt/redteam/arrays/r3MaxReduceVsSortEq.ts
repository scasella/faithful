// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2} adv=[[[-9007199254740992,-9007199254740992,9007199254740992,-1,0,9007199254740992]]]
// Round 3: reduce(max) seeded with xs[0] equals the head of a descending sort.
export function original(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((m, x) => Math.max(m, x), xs[0]);
}
export function candidate(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.slice().sort((a, b) => b - a)[0];
}
