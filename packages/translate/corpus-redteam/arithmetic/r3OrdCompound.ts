// @redteam area=arithmetic status=held expect=ok round=3
// acc += f(...) * x: the call throws before the product is checked
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["throw","throw","throw","throw"]
export function r3OrdCompound(n: number, x: number): number {
  if (n <= 0) { throw new Error("base"); }
  let acc = x;
  acc += r3OrdCompound(n - 1, x) * x;
  return acc;
}
