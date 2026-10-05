// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[-9007199254740992,9007199254740992],[9007199254740991,-1],[-9007199254740992,0],[4503599627370496,-4503599627370496],[4503599627370497,-4503599627370497]]
// @tags ["range-violation","ok","range-violation","ok","range-violation"]
export function absMinMaxEdge(a: number, b: number): number[] {
  return [Math.abs(a) + 1, Math.max(a, b) - Math.min(a, b), Math.min(Math.abs(a), Math.abs(b)) * 2];
}
