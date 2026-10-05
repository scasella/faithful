// @redteam area=arrays status=held
// @redteam note=out-of-range read in the receiver before a throwing self-call in the argument
// @redteam expect=ok
// @redteam inputs=[[[],1],[[5,6],1],[[],0],[[1,2,3,4],3]]
export function orda(xs: number[], n: number): number[] {
  if (n < 0) throw new Error("boom");
  if (n === 0) return [];
  return [xs[n]].concat(orda(xs, n - 2));
}
