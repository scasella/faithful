// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[5,6,7,8,9]],[[]]]
// Round 4 (arrays): filter index is the original index, reduce index is the filtered index.
export function r4FilterThenReduceIndex(xs: number[]): number {
  return xs.filter((x, i) => i % 2 === 1).reduce((acc, x, i) => acc * 10 + x * (i + 1), 0);
}
