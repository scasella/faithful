// @redteam area=arithmetic status=held expect=refuse code=float round=4
// a length bound of 1e400 (Infinity): refused before the measure finder converts it with BigInt
export function r4LenBoundInf(a: number[]): number {
  let xs = a;
  let c = 0;
  while (xs.length > 1e400) {
    xs = xs.slice(1);
    c++;
  }
  return c;
}
