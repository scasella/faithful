// @redteam area=arithmetic status=held expect=ok round=4
// fractional literal TEXT whose double value is an integer (9007199254740991.5 -> 2^53, 4503599627370497.5 -> ...498 ties-to-even, 1.0000000000000001 -> 1): accepted with the double value; the rule is "the literal value is an integer", not "the text is" (sibling of unrepresentableLiteral)
// @inputs [[0],[-9007199254740992],[-4503599627370496],[4503599627370496]]
// @tags ["ok","ok","ok","range-violation"]
export function r4FracLiteralRounds(a: number): number {
  return a + 9007199254740991.5 - 4503599627370497.5 + 1.0000000000000001;
}
