// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// boolean arrays.
export function original(xs: boolean[]): number {
  return xs.includes(true) ? xs.indexOf(false) : 7;
}
export function candidate(xs: boolean[]): number {
  if (xs.filter((x) => x).length === 0) {
    return 7;
  }
  let i = 0;
  for (const x of xs) {
    if (!x) {
      return i;
    }
    i = i + 1;
  }
  return -1;
}
