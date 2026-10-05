// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, option of an array as the return type: the tail, or null for [].
export function original(xs: number[]): number[] | null {
  return xs.length > 0 ? xs.slice(1) : null;
}
export function candidate(xs: number[]): number[] | null {
  if (xs.length === 0) {
    return null;
  }
  return xs.filter((x, i) => i > 0);
}
