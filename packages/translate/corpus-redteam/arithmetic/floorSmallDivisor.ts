// @redteam area=arithmetic status=held expect=ok round=2
// divisor literals 2.0, 1e1, 3e0 are integers
// @inputs [[7],[-7],[0],[9007199254740992]]
// @tags ["ok","ok","ok","ok"]
export function floorSmallDivisor(a: number): number {
  return Math.floor(a / 2.0) + Math.ceil(a / 1e1) + (a % 3e0);
}
