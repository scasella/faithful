// @redteam area=arrays status=held
// @redteam expect=refuse code=no-termination-measure
export function twoUpd(xs: number[]): number {
  let ys = xs;
  let c = 0;
  while (ys.length > 0) {
    ys = ys.slice(1);
    ys = ys.concat([1]);
    c = c + 1;
  }
  return c;
}
