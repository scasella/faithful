// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[]]]
export function revBad(xs: number[]): number[] {
  let out: number[] = [];
  for (let i = xs.length; i > 0; i--) {
    out = out.concat([xs[i]]);
  }
  return out;
}
