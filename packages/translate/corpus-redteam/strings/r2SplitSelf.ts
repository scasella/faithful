// @redteam area=strings status=held
// @inputs [["",""],["a",""],["abc","b"],["",","],["aaa","aa"],["ab","abc"],[",",","]]
export function f(s: string, t: string): string[][] { return [s.split(s), s.split(t), t.split(s), "".split(t)]; }
