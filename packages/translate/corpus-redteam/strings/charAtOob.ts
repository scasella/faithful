// @redteam area=strings status=held
// @inputs [["",0],["",-1],["abc",-1],["abc",3],["abc",2],["abc",9007199254740992],["abc",-9007199254740992],["é\uffff",1]]
export function charAtOob(s: string, i: number): string {
  return s.charAt(i);
}
