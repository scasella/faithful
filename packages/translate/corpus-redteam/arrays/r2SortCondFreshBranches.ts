// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2],true],[[3,1,2],false],[[],true]]
export function srt(xs: number[], c: boolean): number[] {
  return (c ? xs.concat() : xs.map((x) => -x)).sort((a, b) => b - a);
}
