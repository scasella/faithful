// @redteam area=arithmetic status=held expect=ok round=3
// && guards a division inside a filter callback; map squares (2^54 is a violation)
// @inputs [[[0,1,2,-3],10],[[0],0],[[134217728,1],1000000000]]
// @tags ["ok","ok","range-violation"]
export function r3CbAndGuard(xs: number[], k: number): number[] {
  return xs.filter((x) => x !== 0 && Math.floor(k / x) > 1).map((x) => x * x);
}
