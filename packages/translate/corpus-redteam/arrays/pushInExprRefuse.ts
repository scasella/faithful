// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function add2(a: number[]): number {
  const arr = a.slice();
  return arr.push(1);
}
