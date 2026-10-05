// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2]],[[]]]
export function revArr(xs: number[]): number[] {
  const init: number[] = [];
  return xs.reduce((acc, x) => [x].concat(acc), init);
}
