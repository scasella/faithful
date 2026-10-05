// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function prefixes2(xs: number[]): number[][] {
  const init: number[][] = [[]];
  return xs.reduce((acc, x, i) => acc.concat([xs.slice(0, i + 1)]), init);
}
