// @redteam area=arithmetic status=held expect=refuse code=no-termination-measure round=2
// n = Math.floor(n / 1) never decreases; k >= 2 is load-bearing
export function halveByOne(a: number): number {
  let n = a;
  let c = 0;
  while (n > 0) {
    n = Math.floor(n / 1);
    c++;
  }
  return c;
}
