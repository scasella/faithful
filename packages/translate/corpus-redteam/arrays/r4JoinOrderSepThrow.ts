// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[5],1],[[1],1],[[0],2]]
// Round 4 (arrays): receiver before separator for join.
export function r4JoinOrderSepThrow(xs: number[], n: number): string {
  if (n <= 0) throw new Error("base");
  return xs.map((x) => x * 4503599627370496).join(r4JoinOrderSepThrow(xs, n - 1));
}
