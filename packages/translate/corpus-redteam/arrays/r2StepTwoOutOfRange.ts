// @redteam area=arrays status=held
// @redteam note=i += 2 reading xs[i + 1]: odd length reads past the end, must be a range violation on both sides
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4]],[[1,2,3]],[[]]]
export function pairSums(xs: number[]): number[] {
  let out: number[] = [];
  for (let i = 0; i < xs.length; i += 2) {
    out = out.concat([xs[i] + xs[i + 1]]);
  }
  return out;
}
