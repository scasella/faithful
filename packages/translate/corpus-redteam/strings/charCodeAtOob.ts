// @redteam area=strings status=held
// @inputs [["",0],["abc",-1],["abc",3],["abc",0],["é\uffff\u0000",1],["é\uffff\u0000",2],["é",0],["abc",9007199254740992]]
export function charCodeAtOob(s: string, i: number): number {
  return s.charCodeAt(i) + 1;
}
