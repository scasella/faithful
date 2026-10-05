// @redteam area=strings status=held
// @inputs [["Hello World","WORLD",0],["abcABC","bc",2],["abc","",9],["ABC","c",-5]]
export function f(s: string, t: string, k: number): number { return s.toLowerCase().indexOf(t.toLowerCase(), k) + s.toUpperCase().indexOf(t.toUpperCase()); }
