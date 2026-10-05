// @redteam area=arithmetic status=held expect=refuse code=no-termination-measure round=2
// terminates in JS (n >= 1 implies floor(n / -2) <= -1 < 1); refused: completeness gap (negative divisor)
export function recFloorNegDiv(n: number): number {
  if (n < 1) {
    return n;
  }
  return 1 + recFloorNegDiv(Math.floor(n / -2));
}
