// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2,9,8]],[[]],[[1]]]
export function evens(xs: number[]): number[] {
  return xs.filter((x, i) => i % 2 === 0).concat(xs.filter((x, i) => i % 2 !== 0).slice(-1, -0));
}
