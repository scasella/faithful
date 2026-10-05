// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1}
// for...of with an early return of an option, against filter and index.
export function original(xs: number[]): number | null {
  for (const x of xs) {
    if (x < 0) {
      return x;
    }
  }
  return null;
}
export function candidate(xs: number[]): number | null {
  const ys = xs.filter((x) => x < 0);
  return ys.length > 0 ? ys[0] : null;
}
