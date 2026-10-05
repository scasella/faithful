// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4,5],-2,-1],[[1,2,3,4,5],-7,2],[[1,2,3,4,5],3,1],[[1,2,3,4,5],-9007199254740992,9007199254740992],[[1,2,3,4,5],9007199254740992,-9007199254740992],[[],0,-1],[[1,2,3],-3,-4],[[1,2,3],2,-1],[[1,2,3],0,-0]]
export function sl(xs: number[], a: number, b: number): number[] {
  return xs.slice(a, b);
}
