// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]],[[7,8]]]
export function mirror(xs: number[]): number {
  return xs.reduce((acc, x, i) => acc * 10 + xs[xs.length - 1 - i] - x, 0);
}
