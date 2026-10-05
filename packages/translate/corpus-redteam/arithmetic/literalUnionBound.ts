// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[9007199254740992],[-9007199254740992]]
// @tags ["ok","ok"]
export function literalUnionBound(a: 9007199254740992 | -9007199254740992): number {
  return a > 0 ? a - 1 : a + 1;
}
