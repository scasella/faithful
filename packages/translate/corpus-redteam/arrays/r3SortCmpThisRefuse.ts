// @redteam area=arrays status=held
// @redteam note=function-expression comparator with a `this` parameter (three declared parameters)
// @redteam expect=refuse code=unsupported-syntax|this
export function sortThis(xs: number[]): number[] {
  return xs.slice().sort(function (this: void, a: number, b: number): number {
    return a - b;
  });
}
