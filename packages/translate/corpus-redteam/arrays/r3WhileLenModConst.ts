// @redteam area=arrays status=held
// @redteam note=`ys.length > Z` with module const Z = -1 never becomes false
// @redteam expect=refuse code=no-termination-measure
// @redteam inputs=[[[1,2,3]],[[]]]
const Z = -1;
export function modConst(xs: number[]): number {
  let ys = xs;
  let n = 0;
  while (ys.length > Z) {
    if (n > 5) return n;
    n = n + 1;
    ys = ys.slice(1);
  }
  return n;
}
