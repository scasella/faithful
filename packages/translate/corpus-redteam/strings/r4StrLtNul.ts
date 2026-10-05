// @redteam area=strings status=held
// @inputs [["",""],["a","a"],["\u0000",""],["b","a\uffff"],["a","a"]]
export function f(a: string, b: string): boolean[] { return ["a\0" < "a", "" < "\0", a + "\0" < b, a < b + "￿", "é" > "z"]; }
