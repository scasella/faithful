// @redteam area=strings status=held
// @inputs [["",0],["x",-1],["y",9007199254740991],["z",-9007199254740992]]
export function f(s: string, n: number): string { let t = s; t += n + 1; t += "" + n + 1; t += n - 1 + "|"; return t; }
