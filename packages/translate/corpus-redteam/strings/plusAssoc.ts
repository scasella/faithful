// @redteam area=strings status=held
// @inputs [["a",1,2],["",-1,-2],["x",9007199254740991,1],["x",4503599627370496,4503599627370496],["x",9007199254740992,1]]
export function plusAssoc(s: string, n: number, m: number): string[] {
  return [s + n + m, n + m + s, n + (m + s), s + (n + m), n + s + m];
}
