// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, the last element satisfying a predicate: filter then index the last slot vs a loop (filter compaction).
export function original(xs: number[]): number {
  const f = xs.filter((x) => x % 2 !== 0);
  return f.length > 0 ? f[f.length - 1] : 0;
}
export function candidate(xs: number[]): number {
  let last = 0;
  for (const x of xs) {
    if (x % 2 !== 0) {
      last = x;
    }
  }
  return last;
}
