// @redteam area=arithmetic status=held expect=ok round=4
// length * k and indexOf (-1) * k checked at the bound
// @inputs [[[1,2,3],4503599627370496],[[4503599627370496],4503599627370496],[[],9007199254740992],[[5,5],-9007199254740992]]
// @tags ["range-violation","ok","ok","range-violation"]
export function r4LenArith(xs: number[], k: number): number {
  return xs.length * k - xs.indexOf(k) * k;
}
