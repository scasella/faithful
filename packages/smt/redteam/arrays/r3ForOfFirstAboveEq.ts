// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// Round 3: first index above t: for...of with an early return (counter) vs mapI + filter + head.
export function original(xs: number[], t: number): number {
  let k = 0;
  for (const x of xs) {
    if (x > t) return k;
    k = k + 1;
  }
  return -1;
}
export function candidate(xs: number[], t: number): number {
  const ks = xs.map((x, k) => (x > t ? k : -1)).filter((k) => k >= 0);
  return ks.length > 0 ? ks[0] : -1;
}
