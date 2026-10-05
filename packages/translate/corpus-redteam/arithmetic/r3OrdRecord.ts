// @redteam area=arithmetic status=held expect=ok round=3
// evaluation order: the field written first (b: x * x) is evaluated first although the type declares a first; violation before the self-call throws
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["range-violation","range-violation","throw","throw"]
export function r3OrdRecord(n: number, x: number): { a: number; b: number } {
  if (n <= 0) { throw new Error("base"); }
  return { b: x * x, a: r3OrdRecord(n - 1, x).a };
}
