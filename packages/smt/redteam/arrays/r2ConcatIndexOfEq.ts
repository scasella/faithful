// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":2}
// Round 2, indexOf over a concatenation (symbolic first length): the second array's hits are offset by xs.length.
export function original(xs: number[], ys: number[], v: number): number {
  return xs.concat(ys).indexOf(v);
}
export function candidate(xs: number[], ys: number[], v: number): number {
  const a = xs.indexOf(v);
  if (a >= 0) {
    return a;
  }
  const b = ys.indexOf(v);
  return b >= 0 ? xs.length + b : -1;
}
