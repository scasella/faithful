// @redteam area=arrays status=held
// @redteam note=`ys.length >= 0` never becomes false (slice of [] is [])
// @redteam expect=refuse code=no-termination-measure
// @redteam inputs=[[[1,2,3]],[[]]]
export function geZero(xs: number[]): number {
  let ys = xs;
  let n = 0;
  while (ys.length >= 0) {
    if (n > 5) return n;
    n = n + 1;
    ys = ys.slice(1);
  }
  return n;
}
