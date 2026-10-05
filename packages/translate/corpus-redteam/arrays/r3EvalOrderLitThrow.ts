// @redteam area=arrays status=held
// @redteam note=array literal: a throwing self-call before an out-of-range read
// @redteam expect=ok
// @redteam inputs=[[[],1],[[5,6],1],[[],0],[[1,2,3,4],3]]
export function ord(xs: number[], n: number): number[] {
  if (n < 0) throw new Error("boom");
  if (n === 0) return [];
  return [ord(xs, n - 2).length, xs[n]];
}
