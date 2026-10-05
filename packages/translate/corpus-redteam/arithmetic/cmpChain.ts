// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[1,1],[1,2],[2,1],[-9007199254740992,9007199254740992],[0,0]]
// @tags ["ok","ok","ok","ok","ok"]
export function cmpChain(a: number, b: number): boolean {
  return ((a < b) === (b > a)) && ((a <= b) !== (a > b)) && ((a === b) === (a >= b && a <= b));
}
