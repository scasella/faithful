// @redteam area=arithmetic status=held expect=ok round=4
// a checked product in the loop condition that overflows only on the final (exiting) evaluation: plain JS returns 2, both sides must call it a range violation
// @inputs [[4503599627370497,2],[4503599627370497,1],[3,5],[-1,3],[9007199254740992,1]]
// @tags ["range-violation","ok","ok","ok","ok"]
export function r4LoopCondCheckExit(k: number, n: number): number {
  let c = 0;
  for (let i = 0; i * k > -1 && i < n; i++) {
    c += 1;
  }
  return c;
}
