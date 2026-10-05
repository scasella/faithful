// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function f(xs: number[], i: number): number[] {
  return xs.with(i, 0);
}
