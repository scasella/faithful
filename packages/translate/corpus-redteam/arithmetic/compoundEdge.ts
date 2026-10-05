// @redteam area=arithmetic status=held expect=ok round=2
// @inputs [[67108864,7],[94906266,5],[-67108864,3],[3,0],[-5,-4]]
// @tags ["ok","range-violation","range-violation","range-violation","ok"]
export function compoundEdge(a: number, b: number): number {
  let x = a;
  x -= x * x;
  x *= 2;
  x %= b;
  x += -x * 3;
  return x;
}
