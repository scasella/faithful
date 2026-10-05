// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],0],[[1,2,3],2],[[1,2,3],3],[[1,2,3],-1],[[],0]]
export function at(xs: number[], i: number): number {
  return xs[i];
}
