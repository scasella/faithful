// @redteam area=arithmetic status=held expect=ok round=3
// Math.max arguments left to right
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["range-violation","range-violation","throw","throw"]
export function r3OrdMax(n: number, x: number): number {
  if (n <= 0) { throw new Error("base"); }
  return Math.max(x * x, r3OrdMax(n - 1, x));
}
