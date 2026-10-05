// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":2}
// Round 3: reduce's index on a FILTERED array counts kept elements, like a manual counter.
export function original(xs: number[]): number {
  return xs.filter((x) => x > 0).reduce((acc, x, i) => acc + x * i, 0);
}
export function candidate(xs: number[]): number {
  let s = 0;
  let c = 0;
  for (const x of xs) {
    if (x > 0) {
      s = s + x * c;
      c = c + 1;
    }
  }
  return s;
}
