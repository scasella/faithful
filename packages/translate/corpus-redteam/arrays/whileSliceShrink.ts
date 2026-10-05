// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function sumW(xs: number[]): number {
  let ys = xs;
  let s = 0;
  while (ys.length > 0) {
    s = s * 3 + ys[0];
    ys = ys.slice(1);
  }
  return s;
}
