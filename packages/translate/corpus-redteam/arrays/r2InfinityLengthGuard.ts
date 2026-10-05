// @redteam area=arrays status=held
// @redteam note=1e400 is Infinity: the loop-measure literal reader must not crash translate()
// @redteam expect=refuse code=float
export function f(xs: number[]): number {
  let s = 0;
  while (xs.length !== 1e400 && xs.length > 0) {
    s = s + xs[0];
    xs = xs.slice(1);
  }
  return s;
}
