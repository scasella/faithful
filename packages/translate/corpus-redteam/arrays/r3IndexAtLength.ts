// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2],0],[[3,1,2],1],[[],0],[[],1],[[5],3]]
export function atLen(xs: number[], d: number): number {
  return xs[xs.length - d];
}
