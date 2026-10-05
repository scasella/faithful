// @redteam area=arrays status=held
// @redteam note=conditional mixing a tuple and a number[] (TS types it number[])
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[[1,2,3],[4,5],true],[[1],[4,5],false]]
export function tern(xs: number[], t: [number, number], c: boolean): number[] {
  const ys = c ? t : xs;
  return ys.concat([ys.length]);
}
