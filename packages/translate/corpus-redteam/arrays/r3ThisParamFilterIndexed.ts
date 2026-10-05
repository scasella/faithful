// @redteam area=arrays status=held
// @redteam note=correctly refused, but the reason is wrong: it names `i` as "the array itself" because the `this` pseudo-parameter shifts the count (same root cause as r3ThisParam*)
// @redteam expect=refuse code=unsupported-library|this|unsupported-syntax
// @redteam inputs=[[[5,0,7]],[[]]]
export function thisFilterIdx(xs: number[]): number[] {
  return xs.filter(function (this: number, x: number, i: number): boolean {
    return x > i;
  });
}
