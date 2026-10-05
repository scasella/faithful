// @redteam area=arrays status=held
// @redteam note=array indexed with a numeric string literal key
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[4,5]]]
export function strKey(xs: number[]): number {
  return xs["0"];
}
