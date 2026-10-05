// @corpus class=numeric expect=refuse code=no-termination-measure
// @corpus note=The guard is d * d <= n with d++: no syntactic integer strictly decreases; termination needs the nonlinear fact d >= 2 implies d <= d * d (bound isqrt(n) is not in the source). Labeled refuse per subset v1's measure rule; a translator that soundly derives n - d * d (with the invariant d >= 2) should document that encoding.

/**
 * Primality test by trial division up to the square root.
 * Numbers below 2 (including negatives) are not prime.
 */
export function isPrime(n: number): boolean {
  if (n < 2) {
    return false;
  }
  if (n % 2 === 0) {
    return n === 2;
  }
  let d = 3;
  while (d * d <= n) {
    if (n % d === 0) {
      return false;
    }
    d = d + 2;
  }
  return true;
}
