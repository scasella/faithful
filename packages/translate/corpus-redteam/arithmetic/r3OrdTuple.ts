// @redteam area=arithmetic status=held expect=ok round=3
// tuple literal elements left to right
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["throw","throw","throw","throw"]
export function r3OrdTuple(n: number, x: number): [number, number] {
  if (n <= 0) { throw new Error("base"); }
  return [r3OrdTuple(n - 1, x)[0], x * x];
}
