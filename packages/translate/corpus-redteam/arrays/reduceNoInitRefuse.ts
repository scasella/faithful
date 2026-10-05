// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function total(xs: number[]): number {
  return xs.reduce((a, b) => a + b);
}
