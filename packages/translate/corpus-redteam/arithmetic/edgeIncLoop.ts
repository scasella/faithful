// @redteam area=arithmetic status=held expect=ok round=2
// plain JS never leaves the loop (2^53 + 1 rounds to 2^53); the instrumented i++ must report it
// @inputs [[9007199254740990,9007199254740992],[9007199254740989,9007199254740991],[-9007199254740992,-9007199254740990],[5,3]]
// @tags ["range-violation","ok","ok","ok"]
export function edgeIncLoop(a: number, b: number): number {
  let c = 0;
  for (let i = a; i <= b; i++) {
    c = c + 1;
  }
  return c;
}
