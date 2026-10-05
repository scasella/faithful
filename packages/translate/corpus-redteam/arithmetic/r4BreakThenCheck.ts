// @redteam area=arithmetic status=held expect=ok round=4
// checked product guarding a break; the overflow happens on the iteration that would break
// @inputs [[5,2],[3,4503599627370496],[0,9007199254740992],[4,-9007199254740992]]
// @tags ["ok","ok","ok","range-violation"]
export function r4BreakThenCheck(n: number, k: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i * k > 10) {
      break;
    }
    s += i;
  }
  return s * k;
}
