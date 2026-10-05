// @redteam area=arithmetic status=held expect=ok round=3
// template substitutions left to right; x * x violates before the self-call
// @inputs [[1,134217728],[2,134217728],[1,3],[0,134217728]]
// @tags ["range-violation","range-violation","throw","throw"]
export function r3OrdTemplate(n: number, x: number): string {
  if (n <= 0) { throw new Error("base"); }
  return `${x * x}${r3OrdTemplate(n - 1, x)}`;
}
