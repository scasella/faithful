// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function someIt(xs: number[]): boolean {
  return xs.some((x) => x > 0);
}
