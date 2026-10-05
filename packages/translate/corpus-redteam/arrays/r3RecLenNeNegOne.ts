// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function neNeg(xs: number[]): number {
  if (xs.length !== -1) {
    if (xs.length === 0) return 0;
    return 1 + neNeg(xs.slice(1));
  }
  return 0;
}
