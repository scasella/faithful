// @redteam area=arithmetic status=held expect=refuse code=float round=4
// a recursion step of 0.5 (n - 0.5): not a measure and not an integer
export function r4RecStepHalf(n: number): number {
  if (n <= 0) {
    return 0;
  }
  return 1 + r4RecStepHalf(n - 0.5);
}
