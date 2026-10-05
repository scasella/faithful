// @redteam area=arrays status=held
// @redteam expect=refuse code=no-termination-measure
export function condShrink(xs: number[]): number {
  let ys = xs;
  let c = 0;
  while (ys.length > 0) {
    c = c + 1;
    if (c > 3) ys = ys.slice(1);
  }
  return c;
}
