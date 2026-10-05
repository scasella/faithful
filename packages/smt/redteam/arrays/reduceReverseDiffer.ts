// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Prepending in reduce reverses the array.
export function original(xs: number[]): number[] {
  const init: number[] = [];
  return xs.reduce((acc, x) => [x].concat(acc), init);
}
export function candidate(xs: number[]): number[] {
  return xs.map((x) => x);
}
