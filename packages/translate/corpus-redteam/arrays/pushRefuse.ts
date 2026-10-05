// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function add1(a: number[]): number[] {
  let arr = a;
  arr.push(1);
  return arr;
}
