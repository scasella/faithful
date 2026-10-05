// @redteam area=strings status=held
// @inputs [["\u00e9"],["a"],["abcdefghijk"],["\u00e9bcdefghijk"]]
export function f(s: string): boolean { return s.toLowerCase() < s[9]; }
