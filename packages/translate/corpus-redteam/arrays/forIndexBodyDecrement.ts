// @redteam area=arrays status=held
// @redteam expect=refuse code=no-termination-measure
export function stuck(xs: number[]): number {
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    c = c + 1;
    if (xs[i] > 0) i = i - 1;
  }
  return c;
}
