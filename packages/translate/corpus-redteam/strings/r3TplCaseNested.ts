// @redteam area=strings status=held
// @inputs [["Ab",-3],["",0],["Z",9007199254740992]]
export function f(s: string, n: number): string { return `${s.toUpperCase()}-${n}${n < 0}`.toLowerCase(); }
