// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],7],[[],7],[[-1,0,1],0]]
export function horner(xs: number[], init: number): number {
  return xs.reduce((acc, x) => acc * 2 - x, init);
}
