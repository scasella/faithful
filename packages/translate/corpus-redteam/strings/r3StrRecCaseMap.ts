// @redteam area=strings status=held
// @inputs [["aBéC"],["abc"],[""]]
export function f(s: string): string { if (s === "") return ""; return s.charAt(0).toUpperCase() + f(s.slice(1)); }
