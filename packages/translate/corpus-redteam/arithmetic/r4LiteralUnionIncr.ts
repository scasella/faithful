// @redteam area=arithmetic status=held expect=ok round=4
// TypeScript lets j++ leave its literal-union type 1 | 2 (j becomes 3); the model treats it as Int, so the value is still right
// @inputs [[1],[2]]
// @tags ["ok","ok"]
export function r4LiteralUnionIncr(k: 1 | 2): number {
  let j: 1 | 2 = k;
  j++;
  return j * 3;
}
