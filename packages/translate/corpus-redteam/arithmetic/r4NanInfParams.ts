// @redteam area=arithmetic status=held expect=ok round=4
// parameters named NaN and Infinity are ordinary bindings
// @inputs [[1,2],[-3,9007199254740992]]
// @tags ["ok","range-violation"]
export function r4NanInfParams(NaN: number, Infinity: number): number {
  return NaN * 2 - Infinity;
}
