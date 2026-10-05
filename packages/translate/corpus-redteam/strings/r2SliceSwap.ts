// @redteam area=strings status=held
// @inputs [["abcde",1,3],["abcde",3,1],["abcde",-2,-5],["",0,0],["abc",9007199254740992,-9007199254740992],["abc",-9007199254740992,2],["ab",0,2]]
export function f(s: string, a: number, b: number): string[] { return [s.slice(a, b), s.slice(b, a), s.slice(-a, -b), s.slice(a, a), s.charAt(a), s.charAt(-a)]; }
