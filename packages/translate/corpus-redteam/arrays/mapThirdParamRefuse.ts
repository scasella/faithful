// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function m3(xs: number[]): number[] {
  return xs.map((x, i, arr) => arr.length);
}
