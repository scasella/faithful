// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":2}
// First vs last negative.
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
  return ys.length > 0 ? ys[ys.length - 1] : null;
}
