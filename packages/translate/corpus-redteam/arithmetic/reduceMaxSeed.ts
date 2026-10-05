// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[[]],[[-4503599627370496]],[[4503599627370497]],[[1,-5,3]]]
// @tags ["ok","ok","range-violation","ok"]
export function reduceMaxSeed(xs: number[]): number {
  return xs.reduce((m, x) => Math.max(m, x * 2), -9007199254740992);
}
