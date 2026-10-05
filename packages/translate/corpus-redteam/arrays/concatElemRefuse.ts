// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function app(xs: number[], x: number): number[] {
  return xs.concat(x);
}
