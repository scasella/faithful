// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2} adv=[[[9007199254740992,-9007199254740992,9007199254740992,0,-9007199254740992,1]]]
// Round 3: on numbers, ties are indistinguishable, so a descending sort equals the reversed ascending sort.
export function original(xs: number[]): number[] {
  return xs.slice().sort((a, b) => b - a);
}
export function candidate(xs: number[]): number[] {
  return xs
    .slice()
    .sort((a, b) => a - b)
    .reduce((acc: number[], x) => [x].concat(acc), []);
}
