// @redteam area=arithmetic status=held expect=refuse code=no-termination-measure round=2
// Math.ceil(1 / 2) = 1: JS recursion does not terminate from n = 1
export function recCeilHalve(n: number): number {
  if (n < 1) {
    return 0;
  }
  return 1 + recCeilHalve(Math.ceil(n / 2));
}
