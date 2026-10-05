// @redteam area=strings status=held
// @inputs [["abcdef",-2,-1],["abcdef",-100,2],["abcdef",4,2],["abcdef",2,100],["",0,0],["abc",-9007199254740992,9007199254740992],["abc",9007199254740992,-9007199254740992],["héllo",1,-1]]
export function slice2(s: string, a: number, b: number): string {
  return s.slice(a, b);
}
