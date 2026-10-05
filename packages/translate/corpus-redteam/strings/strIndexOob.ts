// @redteam area=strings status=held
// @inputs [["",0],["abc",-1],["abc",3],["abc",1],["é",0]]
export function strIndexOob(s: string, i: number): string {
  return s[i] + "|";
}
