// @redteam area=arithmetic status=held expect=ok round=3
// @inputs [[5,3,true],[3,5,false],[-9007199254740992,1,true],[9007199254740992,9007199254740992,false]]
// @tags ["ok","ok","ok","ok"]
export function r3TernNum(a: number, b: number, c: boolean): number {
  return a + (c ? 1 : -1) * b - (a > b ? a % 3 : Math.ceil(b / 3));
}
