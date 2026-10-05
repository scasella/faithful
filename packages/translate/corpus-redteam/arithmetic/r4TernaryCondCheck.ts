// @redteam area=arithmetic status=held expect=ok round=4
// checked product in a ternary condition, zero divisor only in the else branch
// @inputs [[9007199254740992,2],[2,1],[-3,1],[4503599627370496,4503599627370496],[5,-2]]
// @tags ["range-violation","ok","range-violation","range-violation","ok"]
export function r4TernaryCondCheck(a: number, b: number): number {
  return a * b > 0 ? Math.floor(a / b) : a % (b - 1);
}
