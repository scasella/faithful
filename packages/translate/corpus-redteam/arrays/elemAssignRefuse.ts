// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function set0(a: number[]): number[] {
  const arr = a;
  arr[0] = 1;
  return arr;
}
