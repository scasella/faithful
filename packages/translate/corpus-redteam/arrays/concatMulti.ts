// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1],[2,3]],[[],[]],[[1,2],[]],[[],[4]]]
export function cat3(xs: number[], ys: number[]): number[] {
  const none: number[] = [];
  return xs.concat(ys, xs, none);
}
