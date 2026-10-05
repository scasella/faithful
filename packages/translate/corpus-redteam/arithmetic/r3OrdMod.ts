// @redteam area=arithmetic status=held expect=ok round=3
// same for %
// @inputs [[1,5],[2,5],[0,5],[1,0]]
// @tags ["throw","throw","throw","throw"]
export function r3OrdMod(n: number, b: number): number {
  if (n <= 0) { throw new Error("base"); }
  return r3OrdMod(n - 1, b) % (b - b);
}
