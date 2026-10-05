// @corpus class=recursive expect=ok
// @corpus note=JS % is truncated (Int.tmod): gcd(-12, 18) recurses through gcd(18, -12) and gcd(-12, 6); measure is Math.abs(b), and b === 0 is tested before the %

/**
 * Greatest common divisor by Euclid's algorithm. The result is always
 * non-negative; gcd(0, 0) is 0.
 */
export function gcd(a: number, b: number): number {
  if (b === 0) {
    return Math.abs(a);
  }
  return gcd(b, a % b);
}
