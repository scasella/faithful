// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[5],1],[[1],1],[[],2]]
// Round 4 (arrays): tuple literal: first element (range violation) before the second (throwing self-call).
export function r4TupleLitOrder(xs: number[], n: number): [number[], number] {
  if (n <= 0) throw new Error("base");
  return [xs.map((x) => x * 4503599627370496), r4TupleLitOrder(xs, n - 1)[1]];
}
