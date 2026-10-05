// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function f(xs: number[]): number[] {
  return xs.toReversed();
}
