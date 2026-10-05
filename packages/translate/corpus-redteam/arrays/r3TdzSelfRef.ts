// @redteam area=arrays status=held
// @redteam note=TDZ: the map callback reads the const being initialized
// @redteam expect=refuse code=unsupported-syntax|mutable-capture
// @redteam inputs=[[[1,2]],[[]]]
export function tdzSelf(xs: number[]): number[] {
  const ys: number[] = xs.map((x) => ys.length + x);
  return ys;
}
