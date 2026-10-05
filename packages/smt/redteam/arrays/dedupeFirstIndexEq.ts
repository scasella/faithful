// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// Dedupe keeping first occurrences: filterI with indexOf against a for...of with includes.
export function original(xs: number[]): number[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}
export function candidate(xs: number[]): number[] {
  let out: number[] = [];
  for (const x of xs) {
    if (out.includes(x)) {
      continue;
    }
    out = out.concat([x]);
  }
  return out;
}
