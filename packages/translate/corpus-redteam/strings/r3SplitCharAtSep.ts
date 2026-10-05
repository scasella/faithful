// @redteam area=strings status=held
// @inputs [["abc",9],["a,b",1],["",0],["aXbXc",1]]
export function f(s: string, k: number): string[] { return s.split(s.charAt(k)); }
