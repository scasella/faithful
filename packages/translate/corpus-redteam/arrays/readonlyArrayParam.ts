// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2]],[[]]]
export function ro(xs: readonly number[]): number {
  return xs.length + xs.slice(1).length;
}
