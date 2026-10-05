// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// indexOf returns the FIRST occurrence among duplicates.
export function original(xs: number[], v: number): number {
  return xs.indexOf(v);
}
export function candidate(xs: number[], v: number): number {
  let i = 0;
  for (const x of xs) {
    if (x === v) {
      return i;
    }
    i = i + 1;
  }
  return -1;
}
