// @redteam area=arrays status=held
// @redteam note=callback parameter named `undefined`
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function undefParam(xs: number[]): number[] {
  return xs.map((undefined: number): number => undefined + 1);
}
