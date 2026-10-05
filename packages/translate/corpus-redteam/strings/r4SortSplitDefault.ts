// @redteam area=strings status=held
// @inputs [["b,a,,\u00e9,Z,a"],[""],[","]]
export function f(s: string): string { return s.split(",").sort().join("|"); }
