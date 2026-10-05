// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function grow(xs: number[]): number[] {
  let ys = xs;
  for (const y of ys) {
    ys = ys.concat([y * 10]);
  }
  return ys;
}
