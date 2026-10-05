// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// Round 2, filter compaction: the second kept element vs the second element when it is kept.
export function original(xs: number[]): number {
  const f = xs.filter((x) => x !== 0);
  return f.length > 1 ? f[1] : 0;
}
export function candidate(xs: number[]): number {
  return xs.length > 1 && xs[1] !== 0 ? xs[1] : 0;
}
