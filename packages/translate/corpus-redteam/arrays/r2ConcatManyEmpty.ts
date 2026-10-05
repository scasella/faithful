// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1],[2,3]],[[],[]]]
export function cc(xs: number[], ys: number[]): number[] {
  const e: number[] = [];
  return e.concat(xs, xs.slice(0, 0), ys, xs.slice(5), [0]);
}
