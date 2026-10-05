// @redteam area=arithmetic status=held expect=refuse code=no-termination-measure round=2
// terminates in JS (n >= 2 implies ceil(n/2) < n); refused: completeness gap, only Math.floor halving is recognized
export function recCeilHalve2(n: number): number {
  if (n < 2) {
    return n;
  }
  return 1 + recCeilHalve2(Math.ceil(n / 2));
}
