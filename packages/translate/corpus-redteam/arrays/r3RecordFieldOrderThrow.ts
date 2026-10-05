// @redteam area=arrays status=held
// @redteam note=object literal fields written in non-declaration order: a throwing self-call in field b is evaluated before an out-of-range read in field a
// @redteam expect=ok
// @redteam inputs=[[[],1],[[5,6],1],[[],0],[[1,2,3,4],3]]
type P = { a: number; b: number };
export function recOrd(xs: number[], n: number): P {
  if (n < 0) throw new Error("boom");
  if (n === 0) return { a: 0, b: 0 };
  return { b: recOrd(xs, n - 2).a, a: xs[n] };
}
