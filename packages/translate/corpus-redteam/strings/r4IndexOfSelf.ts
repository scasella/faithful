// @redteam area=strings status=held
// @inputs [["",""],["aa","a"],["abab","ab"],["a",""],["xyz","xyzxyz"]]
export function f(s: string, t: string): number[] { return [s.indexOf(s, 1), s.indexOf("", s.length + 5), s.indexOf(t, t.length), t.indexOf(s, -1), (s + t).indexOf(t, s.length)]; }
