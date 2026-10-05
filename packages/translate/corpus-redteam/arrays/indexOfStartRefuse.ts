// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function from(xs: number[], x: number, k: number): number {
  return xs.indexOf(x, k);
}
