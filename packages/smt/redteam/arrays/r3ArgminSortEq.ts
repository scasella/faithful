// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2} adv=[[[9007199254740992,-9007199254740992,-9007199254740992,0,-9007199254740992,7]]]
// Round 3: argmin through mapI -> tuples -> stable sort by [0] -> [0][1] is the FIRST index of the minimum.
export function original(xs: number[]): number {
  if (xs.length === 0) return -1;
  const ps: [number, number][] = xs.map((x, i) => [x, i]);
  return ps.slice().sort((a, b) => a[0] - b[0])[0][1];
}
export function candidate(xs: number[]): number {
  if (xs.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] < xs[best]) best = i;
  }
  return best;
}
