// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-type
export function opts(xs: number[]): (number | null)[] {
  return xs.map((x) => (x > 0 ? x : null));
}
