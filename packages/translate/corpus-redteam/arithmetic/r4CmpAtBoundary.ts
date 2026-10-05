// @redteam area=arithmetic status=held expect=ok round=4
// comparisons whose plain-JS answers are wrong only because an operand rounded (a + 1 > a at 2^53): must be range violations
// @inputs [[9007199254740992,0],[9007199254740991,1],[-9007199254740992,9007199254740992],[-9007199254740991,-1],[4503599627370496,-4503599627370496]]
// @tags ["range-violation","range-violation","range-violation","range-violation","ok"]
export function r4CmpAtBoundary(a: number, b: number): boolean[] {
  return [a + 1 > a, a - 1 < a, a * 2 === a + a, a - b === -(b - a), Math.floor(a / 2) * 2 <= a];
}
