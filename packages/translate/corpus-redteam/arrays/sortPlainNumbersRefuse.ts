// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function sortNums(xs: number[]): number[] {
  return xs.slice().sort();
}
