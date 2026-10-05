// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[5],1],[[1],1],[[1,2],2],[[],1]]
// Round 4 (arrays): JS evaluates the receiver (range violation) before the initial value (a throwing self-call).
export function r4ReduceOrderInitThrow(xs: number[], n: number): number {
  if (n <= 0) throw new Error("base");
  return xs.map((x) => x * 4503599627370496).reduce((a, b) => a + b, r4ReduceOrderInitThrow(xs, n - 1));
}
