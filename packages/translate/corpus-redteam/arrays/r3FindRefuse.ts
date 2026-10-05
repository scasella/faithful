// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function findIt(xs: number[]): number | undefined {
  return xs.find((x) => x > 0);
}
