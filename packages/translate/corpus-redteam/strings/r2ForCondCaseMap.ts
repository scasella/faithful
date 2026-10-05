// @redteam area=strings status=held
// @inputs [[0],[1],[2],[3]]
export function f(k: number): number { let out = ""; for (let i = 0; i < 3 && out.toLowerCase() !== "zzz"; i++) { out = out + (i === k ? "\u00c9" : "a"); } return out.length; }
