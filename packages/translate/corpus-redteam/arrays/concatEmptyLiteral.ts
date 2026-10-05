// @redteam area=arrays status=held
// @redteam note=documented: an empty [] literal has no inferable element type (never[]) -> missing-annotation
// @redteam expect=refuse code=missing-annotation
export function copy(xs: number[]): number[] {
  return xs.concat([]);
}
