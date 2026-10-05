// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// Indexing a filter result (compaction slots) against a for...of counter.
export function original(xs: number[]): number {
  const ys = xs.filter((x) => x > 0);
  return ys.length > 1 ? ys[1] : -1;
}
export function candidate(xs: number[]): number {
  let seen = 0;
  for (const x of xs) {
    if (x > 0) {
      seen = seen + 1;
      if (seen === 2) {
        return x;
      }
    }
  }
  return -1;
}
