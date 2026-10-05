// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[5,0,2],[5,2,0],[-7,2,-3],[9007199254740992,-1,-1],[-9007199254740992,3,7]]
// @tags ["range-violation","range-violation","ok","range-violation","ok"]
export function nestedFloorDiv(a: number, b: number, c: number): number {
  return Math.floor(Math.floor(a / b) / c) + Math.ceil(Math.ceil(a / c) / b);
}
