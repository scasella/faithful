// @redteam area=arrays status=held
// @redteam note=TDZ: the callback reads a const declared after the map call (ReferenceError in JS; TS does not report it inside a function)
// @redteam expect=refuse code=unsupported-syntax|mutable-capture
// @redteam inputs=[[[1,2]],[[]]]
export function tdz(xs: number[]): number[] {
  const ys = xs.map((x) => x + k);
  const k = 1;
  return ys;
}
