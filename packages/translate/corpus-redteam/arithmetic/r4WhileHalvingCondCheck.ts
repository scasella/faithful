// @redteam area=arithmetic status=held expect=ok round=4
// halving loop whose second condition conjunct is a checked product
// @inputs [[3,4503599627370496],[1,4503599627370496],[7,1],[8,-4503599627370496],[0,9007199254740992]]
// @tags ["range-violation","ok","ok","range-violation","ok"]
export function r4WhileHalvingCondCheck(a: number, m: number): number {
  let n = a;
  let c = 0;
  while (n > 0 && n * m !== 7) {
    n = Math.floor(n / 2);
    c++;
  }
  return c;
}
