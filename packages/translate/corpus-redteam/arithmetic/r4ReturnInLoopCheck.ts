// @redteam area=arithmetic status=held expect=ok round=4
// checked product in a return from inside a loop (Flow.ret path of the twin)
// @inputs [[5,3,4503599627370496],[5,2,4503599627370496],[5,9,9007199254740992],[3,1,-9007199254740992]]
// @tags ["range-violation","ok","ok","ok"]
export function r4ReturnInLoopCheck(n: number, m: number, k: number): number {
  for (let i = 0; i < n; i++) {
    if (i === m) {
      return i * k;
    }
  }
  return -k;
}
