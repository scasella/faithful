// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[5],1],[[1],1],[[0],2]]
// Round 4 (arrays): element access: receiver (range violation) before the index (throwing self-call).
export function r4IndexOrderRecvThenSelf(xs: number[], n: number): number {
  if (n <= 0) throw new Error("base");
  return xs.map((x) => x * 4503599627370496)[r4IndexOrderRecvThenSelf(xs, n - 1)];
}
