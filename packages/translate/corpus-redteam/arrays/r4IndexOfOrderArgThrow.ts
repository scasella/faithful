// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[5],1],[[1],1],[[0],2]]
// Round 4 (arrays): receiver before argument for indexOf.
export function r4IndexOfOrderArgThrow(xs: number[], n: number): number {
  if (n <= 0) throw new Error("base");
  return xs.map((x) => x * 4503599627370496).indexOf(r4IndexOfOrderArgThrow(xs, n - 1));
}
