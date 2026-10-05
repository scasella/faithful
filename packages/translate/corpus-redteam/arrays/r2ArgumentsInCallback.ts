// @redteam area=arrays status=held
// @redteam note=`arguments` inside an arrow callback refers to the enclosing function's arguments object
// @redteam expect=refuse code=unsupported-syntax
export function f(xs: number[]): number[] {
  return xs.map((x) => arguments.length + x);
}
