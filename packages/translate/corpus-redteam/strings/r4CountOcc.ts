// @redteam area=strings status=held
// @inputs [["aaaa","aa"],["",""],["abc",""],["abab","ba"],["x","xy"]]
export function f(s: string, t: string): number { let c = 0; for (let i = 0; i < s.length; i++) { if (s.indexOf(t, i) === i) c++; } return c; }
