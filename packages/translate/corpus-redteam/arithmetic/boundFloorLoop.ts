// @redteam area=arithmetic status=held expect=ok round=2
// a checked division in a counting loop bound, evaluated on every iteration
// @inputs [[10,0],[10,3],[-10,3],[10,-3]]
// @tags ["range-violation","ok","ok","ok"]
export function boundFloorLoop(n: number, d: number): number {
  let s = 0;
  for (let i = 0; i < Math.floor(n / d); i++) {
    s += i;
  }
  return s;
}
