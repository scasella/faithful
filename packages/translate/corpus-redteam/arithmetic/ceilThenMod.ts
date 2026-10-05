// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[-7,2,2],[7,-2,-3],[-1,5,3],[5,1,0]]
// @tags ["ok","ok","ok","range-violation"]
export function ceilThenMod(a: number, b: number, c: number): number {
  return Math.ceil(a / b) % c;
}
