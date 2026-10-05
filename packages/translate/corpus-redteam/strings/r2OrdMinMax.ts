// @redteam area=strings status=held
// @inputs [["\u00e9"],["a"],["abcdefghijk"],["\u00e9bcdefghijk"]]
export function f(s: string): number { return Math.max(s.toLowerCase().length, s.charCodeAt(9), s.toUpperCase().length); }
