// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]],[[7]]]
export function grow(xs: number[]): number[] {
  let ys = xs;
  for (const x of xs) {
    ys = ys.concat([x, ys.length]);
  }
  return ys;
}
