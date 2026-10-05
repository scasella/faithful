// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function sortInPlace(xs: number[]): number[] {
  const ys = xs.slice();
  return ys.sort((a, b) => a - b);
}
