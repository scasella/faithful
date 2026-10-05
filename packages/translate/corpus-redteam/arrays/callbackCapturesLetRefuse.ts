// @redteam area=arrays status=held
// @redteam expect=refuse code=mutable-capture
export function cap(xs: number[]): number[] {
  let k = 1;
  k = k + 1;
  return xs.map((x) => x * k);
}
