// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: using the ORIGINAL index instead of the kept-element counter differs once a non-positive precedes a positive.
export function original(xs: number[]): number {
  return xs.filter((x) => x > 0).reduce((acc, x, i) => acc + x * i, 0);
}
export function candidate(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] > 0) s = s + xs[i] * i;
  }
  return s;
}
