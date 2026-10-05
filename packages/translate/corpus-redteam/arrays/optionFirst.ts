// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[]],[[0]],[[5,6]]]
export function first(xs: number[]): number | null {
  return xs.length > 0 ? xs[0] : null;
}
