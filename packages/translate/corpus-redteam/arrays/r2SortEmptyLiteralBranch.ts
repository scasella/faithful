// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[2,1]],[[]],[[5,5,1]]]
export function srt(xs: number[]): number[] {
  const ys: number[] = xs.length > 2 ? [] : xs.slice();
  return (xs.length > 2 ? [9, 8] : ys.slice()).sort((a, b) => a - b).concat(ys);
}
