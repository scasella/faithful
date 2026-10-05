// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,-2,3,0,5]],[[0]],[[]]]
export function sumUntilZero(xs: number[]): number {
  let s = 0;
  for (const x of xs) {
    if (x < 0) continue;
    if (x === 0) break;
    s = s + x;
  }
  return s;
}
