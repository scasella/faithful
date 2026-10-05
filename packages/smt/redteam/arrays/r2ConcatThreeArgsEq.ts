// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1}
// Round 2, concat with two arguments vs chained concat vs concat([]) / slice() copies.
export function original(xs: number[], ys: number[], zs: number[]): number[] {
  return xs.concat(ys, zs);
}
export function candidate(xs: number[], ys: number[], zs: number[]): number[] {
  const e: number[] = [];
  return xs.slice().concat(ys).concat(e).concat(zs.slice(0));
}
