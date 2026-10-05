// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":2}
// Round 2, as r2ConcatIndexOfEq but forgetting the xs.length offset: differs when v is only in a non-empty ys after a
// non-empty xs.
export function original(xs: number[], ys: number[], v: number): number {
  return xs.concat(ys).indexOf(v);
}
export function candidate(xs: number[], ys: number[], v: number): number {
  const a = xs.indexOf(v);
  if (a >= 0) {
    return a;
  }
  return ys.indexOf(v);
}
