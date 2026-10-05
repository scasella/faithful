// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function bad(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a < b ? -1 : 1));
}
