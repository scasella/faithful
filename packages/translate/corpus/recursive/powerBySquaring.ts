// @corpus class=recursive expect=ok
// @corpus note=exponent halves via Math.floor(exponent / 2) (Int.fdiv); negative base with odd exponent gives a negative result; half * half leaves 2^53 quickly, so most large inputs are range violations
// @corpus throws

/**
 * Raises an integer base to a non-negative integer exponent using
 * exponentiation by squaring (O(log exponent) multiplications).
 */
export function powerBySquaring(base: number, exponent: number): number {
  if (exponent < 0) {
    throw new Error("exponent must be non-negative");
  }
  if (exponent === 0) {
    return 1;
  }
  const half = powerBySquaring(base, Math.floor(exponent / 2));
  if (exponent % 2 === 0) {
    return half * half;
  }
  return half * half * base;
}
