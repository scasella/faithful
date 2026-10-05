// @redteam area=strings status=held
// @inputs [["abc",9],["abca",3],["",0]]
export function f(s: string, k: number): number { return s.indexOf(s.charAt(k), k) + s.indexOf(s.charAt(k)); }
