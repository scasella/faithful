// @redteam area=strings status=held
// @inputs [["abc",9007199254740992],["abc",-9007199254740992],["",0],["abcd",-2]]
export function f(s: string, n: number): string[] { return [s.slice(n), s.slice(-n), s.slice(n, -n), s.slice(-n, n)]; }
