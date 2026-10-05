// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]],[[4]]]
export function revLen(xs: number[]): number {
  let ys = xs;
  let s = 0;
  while (1 <= ys.length) {
    s = s * 10 + ys[0];
    ys = ys.slice(1);
  }
  return s;
}
