// @smt-redteam expect=equal bounds={"array":3,"string":2,"int":1}
// includes / indexOf on string elements compare whole strings, including "" and prefixes.
export function original(xs: string[], s: string): number {
  return xs.includes(s) ? xs.indexOf(s) : -1;
}
export function candidate(xs: string[], s: string): number {
  let i = 0;
  for (const x of xs) {
    if (x === s) {
      return i;
    }
    i = i + 1;
  }
  return -1;
}
