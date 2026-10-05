// @redteam area=arithmetic status=held expect=ok round=3
// the divisor itself is a throwing self-call
// @inputs [[1,5],[2,5],[0,5],[1,0]]
// @tags ["throw","throw","throw","throw"]
export function r3OrdCeilDivisor(n: number, b: number): number {
  if (n <= 0) { throw new Error("base"); }
  return Math.ceil(b / r3OrdCeilDivisor(n - 1, b));
}
