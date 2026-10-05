// @redteam area=arithmetic status=held expect=ok round=3
// mirror of r3OrdRecord: the self-call throws before x * x is evaluated
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["throw","throw","throw","throw"]
export function r3OrdRecordRev(n: number, x: number): { a: number; b: number } {
  if (n <= 0) { throw new Error("base"); }
  return { a: r3OrdRecordRev(n - 1, x).a, b: x * x };
}
