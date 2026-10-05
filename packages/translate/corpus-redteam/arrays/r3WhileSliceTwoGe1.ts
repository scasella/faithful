// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4,5]],[[]],[[1]]]
export function every2(xs: number[]): number {
  let ys = xs;
  let s = 0;
  while (ys.length >= 1) {
    s = s * 10 + ys[0];
    ys = ys.slice(2);
  }
  return s;
}
