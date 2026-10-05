// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4]],[[1,2,3]],[[]]]
export function pairSums(xs: number[]): number[] {
  let out: number[] = [];
  for (let i = 0; i < xs.length; i += 2) {
    out = out.concat([xs[i] + xs[i + 1]]);
  }
  return out;
}
