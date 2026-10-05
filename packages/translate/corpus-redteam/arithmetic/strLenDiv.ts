// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [["abc","de"],["","x"],["abcd",""],["xyzw","xy"]]
// @tags ["ok","ok","range-violation","ok"]
export function strLenDiv(s: string, t: string): number {
  return Math.floor(s.length / t.length) - (s.length % t.length) * (s.length - t.length);
}
