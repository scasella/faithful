// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":3}
// Round 2, xs.concat(ys)[i] against a branch on i < xs.length: out of range both leave the model (bounds check), in
// range both read the same element (concat with a symbolic first length).
export function original(xs: number[], ys: number[], i: number): number {
  return xs.concat(ys)[i];
}
export function candidate(xs: number[], ys: number[], i: number): number {
  if (i >= 0 && i < xs.length) {
    return xs[i];
  }
  return ys[i - xs.length];
}
