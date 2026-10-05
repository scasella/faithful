// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1],[2,3]],[[4],[]]],[[],[[]]],[[[]],[]]]
export function catNested(xss: number[][], yss: number[][]): number[] {
  const zs = xss.concat(yss);
  const none: number[] = [];
  return zs.map((r) => r.length).concat(zs.length === 0 ? none : zs[0]);
}
