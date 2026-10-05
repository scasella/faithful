// @redteam area=arithmetic status=held expect=ok round=3
// a checked product in a counting-loop bound (boundFloorLoop covered fdiv); 94906265^2 < 2^53 < 94906266^2
// @inputs [[134217728],[94906266],[94906265],[2],[-3],[0]]
// @tags ["range-violation","range-violation","ok","ok","ok","ok"]
export function r3LoopMulBound(n: number): number {
  let c = 0;
  for (let i = 0; i < n * n; i += 1) { c += 1; if (c > 3) { return c; } }
  return c;
}
