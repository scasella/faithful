// @redteam area=strings status=held
// @inputs [["abc"],[""],["\u00e9"]]
export function f(s: string): string { return s.charAt(0) + s.\u{73}lice(1); }
