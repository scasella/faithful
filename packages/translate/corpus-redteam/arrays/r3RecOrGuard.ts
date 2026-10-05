// @redteam area=arrays status=held
// @redteam note=guard `xs.length > 0 || n > 0` implies neither measure
// @redteam expect=refuse code=no-termination-measure
// @redteam inputs=[[[1,2],5],[[],0],[[1,2,3],1]]
export function orGuard(xs: number[], n: number): number {
  if (xs.length > 0 || n > 0) return 1 + orGuard(xs.slice(1), n - 1);
  return 0;
}
