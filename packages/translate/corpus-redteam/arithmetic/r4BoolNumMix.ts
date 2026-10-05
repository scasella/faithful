// @redteam area=arithmetic status=held expect=ok round=4
// booleans and numbers mixed into one string, including (a === 0) === b
// @inputs [[0,true],[-1,false],[9007199254740992,true]]
// @tags ["ok","ok","ok"]
export function r4BoolNumMix(a: number, b: boolean): string {
  return a + "" + b + (a > 0) + !b + (a === 0 === b) + `${b}${a < 0 !== b}`;
}
