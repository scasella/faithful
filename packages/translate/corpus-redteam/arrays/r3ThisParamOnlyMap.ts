// @redteam area=arrays status=held
// @redteam note=held by coincidence: the only parameter is `this` (bound to the element by the model) and the body ignores it; not evidence that `this` parameters are handled
// @redteam expect=ok
// @redteam inputs=[[[5,6,7]],[[]]]
export function thisOnly(xs: number[]): number[] {
  return xs.map(function (this: number): number {
    return 1;
  });
}
