// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],[0,2,4]],[[],[1]],[[5],[]]]
export function pairsAbove(xs: number[], zs: number[]): number[] {
  let out: number[] = [];
  for (const x of xs) {
    out = out.concat(zs.filter((z) => z > x));
  }
  return out;
}
