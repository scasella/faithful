// @redteam area=arrays status=held
// @redteam note=optional callback parameter `i?: number`
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[[4,5]]]
export function optCb(xs: number[]): number[] {
  return xs.map((x: number, i?: number): number => x);
}
