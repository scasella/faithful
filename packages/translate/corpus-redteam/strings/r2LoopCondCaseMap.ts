// @redteam area=strings status=held
// @inputs [[0],[1],[2],[3]]
export function f(k: number): string { let out = ""; let i = 0; while (out.toUpperCase().length < 3 && i < 5) { out = out + (i === k ? "\u00e9" : "a"); i++; } return out; }
