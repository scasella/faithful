// @redteam area=strings status=held
// @inputs [["abc",0],["abc",1],["",0],["abc",9007199254740992],["abc",-2]]
export function f(s: string, k: number): string[] { return [s.slice(-s.length - 1), s.slice(0, -s.length), s.slice(-k, -k + 1), s.slice(s.length), s.slice(k - s.length)]; }
