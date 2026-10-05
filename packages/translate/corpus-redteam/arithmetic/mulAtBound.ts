// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[67108864,134217728],[-67108864,134217728],[3,3002399751580331],[94906265,94906265],[94906266,94906266],[2,4503599627370496],[2,4503599627370497],[-1,-9007199254740992],[-9007199254740992,-9007199254740992],[0,9007199254740992]]
// @tags ["ok","ok","range-violation","ok","range-violation","ok","range-violation","ok","range-violation","ok"]
export function mulAtBound(a: number, b: number): number {
  return a * b;
}
