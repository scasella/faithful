// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// First vs last occurrence.
export function original(xs: number[], v: number): number {
  return xs.indexOf(v);
}
export function candidate(xs: number[], v: number): number {
  let r = -1;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === v) {
      r = i;
    }
  }
  return r;
}
