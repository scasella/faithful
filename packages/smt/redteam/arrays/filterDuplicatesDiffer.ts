// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Removing every occurrence vs subtracting one: differs only with duplicates.
export function original(xs: number[], v: number): number {
  return xs.filter((x) => x !== v).length;
}
export function candidate(xs: number[], v: number): number {
  return xs.length - (xs.includes(v) ? 1 : 0);
}
