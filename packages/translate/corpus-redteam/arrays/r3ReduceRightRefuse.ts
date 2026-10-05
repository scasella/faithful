// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function rr(xs: number[]): number {
  return xs.reduceRight((acc, x) => acc * 10 + x, 0);
}
