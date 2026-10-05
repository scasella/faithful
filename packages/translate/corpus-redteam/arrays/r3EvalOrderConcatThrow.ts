// @redteam area=arrays status=held
// @redteam note=concat receiver (throwing self-call) before an out-of-range read in the argument
// @redteam expect=ok
// @redteam inputs=[[[],1],[[5,6],1],[[],0],[[1,2,3,4],3]]
export function ordc(xs: number[], n: number): number[] {
  if (n < 0) throw new Error("boom");
  if (n === 0) return [];
  return ordc(xs, n - 2).concat([xs[n]]);
}
