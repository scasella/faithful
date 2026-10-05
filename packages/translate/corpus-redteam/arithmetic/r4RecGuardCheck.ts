// @redteam area=arithmetic status=held expect=ok round=4
// checked product in the second disjunct of a recursion guard (only evaluated when n > 0)
// @inputs [[3,4503599627370496],[2,4503599627370497],[5,2],[1,9007199254740992],[3,-4503599627370496]]
// @tags ["range-violation","range-violation","ok","ok","range-violation"]
export function r4RecGuardCheck(n: number, k: number): number {
  if (n <= 0 || n * k > 100) {
    return 0;
  }
  return 1 + r4RecGuardCheck(n - 1, k);
}
