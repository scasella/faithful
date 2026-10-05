// @redteam area=arrays status=held
// @redteam note=a tuple passed to a number[] parameter of a self-call
// @redteam expect=refuse code=unsupported-type|unsupported-syntax
// @redteam inputs=[[[1,2,3],[4,5]],[[],[0,0]]]
export function tupArr(xs: number[], t: [number, number]): number[] {
  if (xs.length === 0) return xs;
  return tupArr(t, t).concat(xs);
}
