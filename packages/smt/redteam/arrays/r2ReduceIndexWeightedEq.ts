// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":3}
// Round 2, reduce with the index parameter vs an index loop.
export function original(xs: number[]): number {
  return xs.reduce((a, x, i) => a + x * (i + 1), 0);
}
export function candidate(xs: number[]): number {
  let s = 0;
  for (let i = xs.length - 1; i >= 0; i--) {
    s = s + xs[i] * (i + 1);
  }
  return s;
}
