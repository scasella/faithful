// @redteam area=arithmetic status=held expect=ok round=2
// a const of literal-union type 94906267 | -3 squared: the product must be checked
// @inputs [[1,true],[1,false],[-3,false],[0,true]]
// @tags ["range-violation","ok","ok","range-violation"]
export function ternaryUnionConst(a: number, c: boolean): number {
  const k = c ? 94906267 : -3;
  return k * k * a;
}
