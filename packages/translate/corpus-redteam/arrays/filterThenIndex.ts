// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,-2,3]],[[-1,-2]],[[]]]
export function firstPos(xs: number[]): number {
  return xs.filter((x) => x > 0)[0];
}
