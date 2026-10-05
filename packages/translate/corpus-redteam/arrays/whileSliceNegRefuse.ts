// @redteam area=arrays status=held
// @redteam expect=refuse code=no-termination-measure
export function spinNeg(xs: number[]): number {
  let ys = xs;
  let s = 0;
  while (ys.length > 0) {
    s = s + 1;
    ys = ys.slice(-1);
  }
  return s;
}
