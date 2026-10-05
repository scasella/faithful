// @redteam area=arithmetic status=held expect=ok round=3
// dividend throws before the zero-divisor check
// @inputs [[1,5],[2,5],[0,5],[1,0]]
// @tags ["throw","throw","throw","throw"]
export function r3OrdFloorDiv(n: number, b: number): number {
  if (n <= 0) { throw new Error("base"); }
  return Math.floor(r3OrdFloorDiv(n - 1, b) / (b - b));
}
