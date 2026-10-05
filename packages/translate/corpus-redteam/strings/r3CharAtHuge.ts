// @redteam area=strings status=held
// @inputs [["abc",9007199254740992],["abc",-9007199254740992],["",0],["abc",2]]
export function f(s: string, n: number): string { return s.charAt(n) + "|" + s.charAt(-n) + "|" + s.charAt(n - 1); }
