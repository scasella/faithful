// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2}
// Round 2, reassigning the iterated variable inside for...of: JavaScript keeps iterating the original array.
export function original(xs: number[]): number[] {
  let ys = xs;
  for (const x of ys) {
    ys = ys.concat([x]);
  }
  return ys;
}
export function candidate(xs: number[]): number[] {
  return xs.concat(xs);
}
