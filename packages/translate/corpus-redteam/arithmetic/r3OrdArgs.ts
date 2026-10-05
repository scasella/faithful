// @redteam area=arithmetic status=held expect=ok round=3
// self-call arguments evaluated (and checked) before the depth check and the call
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["range-violation","range-violation","throw","throw"]
export function r3OrdArgs(n: number, x: number): number {
  if (n <= 0) { throw new Error("base"); }
  return r3OrdArgs(n - 1, x * x) + r3OrdArgs(n - 1, x);
}
