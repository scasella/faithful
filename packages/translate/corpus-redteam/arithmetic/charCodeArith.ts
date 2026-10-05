// @redteam area=arithmetic status=held expect=ok
// @inputs [["123",0],["a",0],["",0],["ab",2],["ab",-1],["￿",0]]
export function charCodeArith(s: string, i: number): number { return s.charCodeAt(i) - 48 + s.indexOf("a") * 10 + s.length; }
