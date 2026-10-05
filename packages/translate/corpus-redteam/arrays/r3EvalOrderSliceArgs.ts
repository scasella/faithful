// @redteam area=arrays status=held
// @redteam note=slice arguments: out-of-range read before a throwing self-call
// @redteam expect=ok
// @redteam inputs=[[[],1],[[5,6],1],[[],0],[[1,2,3,4],3]]
export function ords(xs: number[], n: number): number[] {
  if (n < 0) throw new Error("boom");
  if (n === 0) return [];
  return xs.slice(xs[n], ords(xs, n - 2).length);
}
