// @redteam area=arithmetic status=held expect=ok round=2
// `typeof NaN` is the type number; accepting it is sound
// @inputs [[1],[9007199254740991],[9007199254740992]]
// @tags ["ok","ok","range-violation"]
export function typeofNaN(a: typeof NaN): number {
  return a + 1;
}
