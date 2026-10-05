// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function bump(a: number[]): number[] {
  a[0]++;
  return a;
}
