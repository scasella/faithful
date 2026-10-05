// @redteam area=arrays status=held
// @redteam note=filter callback with a block body returning a number: TS accepts (predicate returns unknown), JS filters by truthiness; must be refused
// @redteam expect=refuse code=unsupported-type
// @redteam inputs=[[[0,1,2,0,-3]]]
export function nz(xs: number[]): number[] {
  return xs.filter((x) => {
    return x;
  });
}
