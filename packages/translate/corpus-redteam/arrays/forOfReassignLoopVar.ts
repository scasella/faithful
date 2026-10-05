// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]],[[-5]]]
export function dbl(xs: number[]): number {
  let s = 0;
  for (let x of xs) {
    x = x * 2;
    s = s + x;
  }
  return s;
}
