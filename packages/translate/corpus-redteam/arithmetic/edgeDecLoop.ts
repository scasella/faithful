// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[-9007199254740990,-9007199254740992],[-9007199254740989,-9007199254740991],[9007199254740992,9007199254740990]]
// @tags ["range-violation","ok","ok"]
export function edgeDecLoop(a: number, b: number): number {
  let c = 0;
  for (let i = a; i >= b; i--) {
    c = c + 1;
  }
  return c;
}
