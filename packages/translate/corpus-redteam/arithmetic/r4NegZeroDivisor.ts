// @redteam area=arithmetic status=held expect=ok round=4
// divisors that are -0 (b * 0 with b < 0, -b * 0, 0 * -b): -0 === 0, so the nonzero check fires on both sides
// @inputs [[1,2],[0,-3],[-5,-1]]
// @tags ["range-violation","range-violation","range-violation"]
export function r4NegZeroDivisor(a: number, b: number): number {
  return Math.floor(a / (b * 0)) + Math.ceil(a / (-b * 0)) + (a % (0 * -b));
}
