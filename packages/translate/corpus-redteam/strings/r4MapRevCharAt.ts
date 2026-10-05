// @redteam area=strings status=held
// @inputs [["abc"],[""],["\u00e9\uffff\u0000"]]
export function f(s: string): string { return s.split("").map((c, i) => c + s.charAt(s.length - 1 - i)).join(""); }
