// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: `<=` finds the LAST index of the minimum; the stable sort's [0][1] is the first.
export function original(xs: number[]): number {
  if (xs.length === 0) return -1;
  const ps: [number, number][] = xs.map((x, i) => [x, i]);
  return ps.slice().sort((a, b) => a[0] - b[0])[0][1];
}
export function candidate(xs: number[]): number {
  if (xs.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] <= xs[best]) best = i;
  }
  return best;
}
