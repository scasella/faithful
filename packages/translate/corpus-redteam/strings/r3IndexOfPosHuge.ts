// @redteam area=strings status=held
// @inputs [["abc","",9007199254740992],["abc","c",-9007199254740992],["","",-1],["aaa","aa",1]]
export function f(s: string, t: string, n: number): number[] { return [s.indexOf(t, n), s.indexOf(t, -n), s.indexOf(t, n + 1)]; }
