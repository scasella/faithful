// @corpus class=numeric expect=ok
// @corpus note=JS % is truncated (sign of dividend): gcd(-12, 18) recurses through a % b with a negative a; result is made non-negative only by the final Math.abs. Measure: |b| strictly decreases.

/**
 * Greatest common divisor by Euclid's algorithm. Accepts negative inputs;
 * the result is always non-negative, and gcd(0, 0) is 0.
 */
export function gcd(a: number, b: number): number {
  if (b === 0) {
    return Math.abs(a);
  }
  return gcd(b, a % b);
}
