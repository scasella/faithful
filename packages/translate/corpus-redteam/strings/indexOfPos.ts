// @redteam area=strings status=held
// @inputs [["abc","",5],["abc","",-5],["abc","",3],["","",0],["abcabc","bc",2],["abcabc","bc",-9007199254740992],["abcabc","bc",9007199254740992],["aaa","aa",1],["abc","abcd",0],["abc","c",3]]
export function indexOfPos(s: string, sub: string, p: number): number {
  return s.indexOf(sub, p);
}
