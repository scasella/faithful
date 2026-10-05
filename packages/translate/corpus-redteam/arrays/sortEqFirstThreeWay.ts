// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2,1,3]],[[9007199254740992,-9007199254740992,0]]]
export function s3(xs: number[]): number[] {
  return xs.map((x) => x).sort((a, b) => { return a === b ? 0 : a < b ? -1 : 1; });
}
