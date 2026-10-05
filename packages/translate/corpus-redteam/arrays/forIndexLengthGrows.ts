// @redteam area=arrays status=held
// @redteam expect=refuse code=no-termination-measure
export function growIdx(xs: number[]): number {
  let ys = xs;
  let c = 0;
  for (let i = 0; i < ys.length; i++) {
    if (ys.length < 5) ys = ys.concat([i]);
    c = c + 1;
  }
  return c;
}
