// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3]],[[1]],[[]]]
export function sni(xs: number[]): number {
  return xs.slice(-2)[1];
}
