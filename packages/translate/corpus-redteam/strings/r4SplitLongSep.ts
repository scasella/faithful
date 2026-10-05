// @redteam area=strings status=held
// @inputs [["",""],["a","a"],["\u00e9a\u00e9","\u00e9"],["abc","abcd"],["aaa","aa"]]
export function f(s: string, t: string): number[] { return [s.split(s + "x").length, s.split(t).length, (s + t + s).split(t).length, s.split("é").length]; }
