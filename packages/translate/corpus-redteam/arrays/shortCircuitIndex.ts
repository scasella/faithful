// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],3],[[1,2,3],-1],[[1,-2,3],1],[[],0]]
export function posAt(xs: number[], i: number): boolean {
  return i >= 0 && i < xs.length && xs[i] > 0;
}
