// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],9007199254740992,9007199254740992],[[1,2,3],-9007199254740992,9007199254740992],[[1,2,3],-9007199254740992,-9007199254740992],[[1,2,3],2,-9007199254740992],[[1,2,3],-2,-1],[[1,2,3],-1,-2],[[],-1,1],[[1,2,3],3,1]]
export function sl(xs: number[], a: number, b: number): number[] {
  return xs.slice(a, b).concat(xs.slice(b)).concat(xs.slice(a));
}
