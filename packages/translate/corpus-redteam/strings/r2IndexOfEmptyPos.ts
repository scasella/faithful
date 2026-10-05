// @redteam area=strings status=held
// @inputs [["",0],["",-5],["abc",3],["abc",4],["abc",9007199254740992],["abc",-9007199254740992],["aaa",1],["abab",2],["x",1]]
export function f(s: string, p: number): number[] { return [s.indexOf("", p), s.indexOf(s, p), s.indexOf(s.slice(1), p), s.indexOf("zz", p)]; }
