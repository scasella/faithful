// @redteam area=arrays status=held
// @redteam note=generator filter callback: the generator object is truthy, so JS keeps every element (TS accepts: predicate returns unknown)
// @redteam expect=refuse code=async
// @redteam inputs=[[[5,0,-7]],[[]]]
export function genFilter(xs: number[]): number[] {
  return xs.filter(function* (x: number): Generator<number, boolean> {
    return x > 0;
  });
}
