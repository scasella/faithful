// @redteam area=arithmetic status=held expect=ok round=3
// checks inside a reduce callback: x % (i + 1) and Math.floor(x / (i - 1)) (zero divisor at i = 1)
// @inputs [[[5]],[[5,7]],[[5,7,9]],[[-9,8,-7,6]],[[]]]
// @tags ["ok","range-violation","range-violation","range-violation","ok"]
export function r3CbModFloor(xs: number[]): number {
  return xs.reduce((acc, x, i) => acc + (x % (i + 1)) * Math.floor(x / (i - 1)), 0);
}
