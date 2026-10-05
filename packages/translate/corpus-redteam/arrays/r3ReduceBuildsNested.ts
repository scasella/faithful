// @redteam area=arrays status=held
// @redteam note=`as` on the initial value
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[1,2,3]],[[]]]
export function prefixes(xs: number[]): number[][] {
  return xs.reduce((acc: number[][], x: number, i: number) => acc.concat([xs.slice(0, i + 1)]), [[]] as number[][]);
}
