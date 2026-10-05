// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Dedupe keeping first vs last occurrences (order differs).
export function original(xs: number[]): number[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}
export function candidate(xs: number[]): number[] {
  let out: number[] = [];
  for (const x of xs) {
    out = out.filter((y) => y !== x).concat([x]);
  }
  return out;
}
