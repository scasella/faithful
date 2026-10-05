// @redteam area=arithmetic status=held expect=ok round=2
// i += 2 from 2^53 - 1 is 2^53 + 1, which rounds to 2^53 in JS and ends the loop; outside the model
// @inputs [[9007199254740989,9007199254740992],[9007199254740988,9007199254740992],[-9007199254740992,-9007199254740989]]
// @tags ["range-violation","ok","ok"]
export function edgeStepLoop(a: number, b: number): number {
  let c = 0;
  for (let i = a; i < b; i += 2) {
    c = c + 1;
  }
  return c;
}
