// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[10,20,30]],[[]],[[1]]]
export function dot(xs: number[]): number {
  return xs.reduce((acc, x, i) => acc + x * i, 100);
}
