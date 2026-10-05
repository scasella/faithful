// @redteam area=strings status=held
// @inputs [["a,b",true],["",true],["a,b",false],[",,",true]]
export function f(s: string, c: boolean): string | undefined { return c ? s.split(",").join(s.charAt(0)) : undefined; }
