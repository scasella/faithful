// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,-2]],[[]]]
export function wrap(xs: number[]): { v: number; neg: boolean }[] {
  return xs.map((x) => ({ neg: x < 0, v: -x }));
}
