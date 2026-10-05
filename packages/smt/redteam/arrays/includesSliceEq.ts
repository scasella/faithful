// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// includes on a slice (padding slots of the slice must not be found).
export function original(xs: number[], v: number): boolean {
  return xs.slice(1).includes(v);
}
export function candidate(xs: number[], v: number): boolean {
  return xs.filter((x, i) => i >= 1 && x === v).length > 0;
}
