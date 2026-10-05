// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function clear(a: number[]): number[] {
  const arr = a;
  arr.length = 0;
  return a;
}
