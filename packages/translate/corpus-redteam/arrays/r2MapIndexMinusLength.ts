// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[7,8,9]],[[]]]
export function f(xs: number[]): number[] {
  return xs.map((x, i) => i - xs.length).filter((d, j) => d + j < 0);
}
