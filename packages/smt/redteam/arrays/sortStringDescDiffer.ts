// @smt-redteam expect=differ bounds={"array":3,"string":2,"int":1}
// String-key sort direction.
export function original(xs: string[]): string[] {
  return xs.slice().sort();
}
export function candidate(xs: string[]): string[] {
  return xs.slice().sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
