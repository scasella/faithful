// @redteam area=arithmetic status=held expect=ok round=4
// string < on decimal renderings of negative numbers ("-10" < "-9")
// @inputs [[9,10],[-1,-2],[-10,-9],[9007199254740992,-9007199254740992]]
// @tags ["ok","ok","ok","ok"]
export function r4StrCmpOfNums(a: number, b: number): boolean {
  return `${a}` < `${b}`;
}
