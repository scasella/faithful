// @redteam area=arithmetic status=held expect=ok round=3
// comparison operands left to right
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["throw","throw","throw","throw"]
export function r3OrdCmp(n: number, x: number): boolean {
  if (n <= 0) { throw new Error("base"); }
  return r3OrdCmp(n - 1, x) === (x * x > 0);
}
