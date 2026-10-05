// @redteam area=arithmetic status=held expect=ok round=4
// abs/min/max are unchecked (cannot leave the range) but their sums are checked
// @inputs [[-9007199254740992,9007199254740992],[9007199254740992,-9007199254740992],[-9007199254740992,0],[0,0],[3,-4]]
// @tags ["range-violation","range-violation","range-violation","ok","ok"]
export function r4MinMaxAbsBound(a: number, b: number): number {
  return Math.abs(Math.min(a, b)) - Math.abs(Math.max(a, b)) + Math.max(-a, -b, Math.abs(a - b) - 9007199254740992);
}
