// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1}
// concat associativity with symbolic lengths on both sides.
export function original(xs: number[], ys: number[]): number[] {
  return xs.concat(ys).concat(xs);
}
export function candidate(xs: number[], ys: number[]): number[] {
  return xs.concat(ys.concat(xs));
}
