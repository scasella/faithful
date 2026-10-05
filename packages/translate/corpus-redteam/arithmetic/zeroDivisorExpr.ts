// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[5,3],[0,0]]
// @tags ["range-violation","range-violation"]
export function zeroDivisorExpr(a: number, b: number): number {
  return Math.ceil(a / (b - b));
}
