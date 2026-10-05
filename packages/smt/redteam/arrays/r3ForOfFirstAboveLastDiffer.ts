// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: as r3ForOfFirstAboveEq, but the candidate takes the LAST matching index.
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
  return ks.length > 0 ? ks[ks.length - 1] : -1;
}
