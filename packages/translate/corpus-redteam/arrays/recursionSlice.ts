// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function rsum(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs[0] + 2 * rsum(xs.slice(1));
}
