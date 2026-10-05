// @redteam area=arithmetic status=held expect=refuse code=float round=2
export function loopBoundHalf(a: number): number {
  let n = a;
  let c = 0;
  while (n > 0.5) {
    n = Math.floor(n / 2);
    c++;
  }
  return c;
}
