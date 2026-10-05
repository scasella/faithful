// @redteam area=strings status=held
// @inputs [["abc"],[""],["\u00e9\uffff\u0000"]]
export function f(s0: string): string { let s = s0; let out = ""; while (s !== "") { out = `${s.charAt(0)}${out}`; s = s.slice(1); } return out; }
