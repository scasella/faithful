// @redteam area=arithmetic status=held expect=ok round=4
// checked product only on odd iterations (even ones continue first)
// @inputs [[2,9007199254740992],[3,9007199254740992],[4,4503599627370496],[6,3]]
// @tags ["ok","ok","range-violation","ok"]
export function r4ContinueCheck(n: number, k: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      continue;
    }
    s += i * k;
  }
  return s;
}
