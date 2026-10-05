// @redteam area=arrays status=held
// @redteam note=ES2023 non-mutating array methods are not in the v1 library
// @redteam expect=refuse code=unsupported-library
export function f(xs: number[]): number[] {
  return xs.toSorted((a, b) => a - b);
}
