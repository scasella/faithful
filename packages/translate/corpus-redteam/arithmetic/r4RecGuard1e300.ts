// @redteam area=arithmetic status=held expect=refuse code=unsupported-syntax round=4
// a recursion guard literal outside +-2^53 (1e300): refused, not a crash of the measure finder
export function r4RecGuard1e300(n: number): number {
  if (n <= 1e300) {
    return 0;
  }
  return 1 + r4RecGuard1e300(n - 1);
}
