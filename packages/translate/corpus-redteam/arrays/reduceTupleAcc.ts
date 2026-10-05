// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,-1,4,-1,5]],[[]]]
export function minMax(xs: number[]): [number, number] {
  const init: [number, number] = [0, 0];
  return xs.reduce((acc, x): [number, number] => [Math.min(acc[0], x), Math.max(acc[1], x)], init);
}
