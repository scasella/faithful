// @corpus class=numeric expect=ok
// @corpus throws
// @corpus note=Square-and-multiply squares the base one more time than the result needs: intPow(2^27, 1) is in range but the final b * b = 2^54 leaves +-2^53, so rangeOk must reject inputs whose result alone is fine. Measure: e strictly decreases via Math.floor(e / 2) while e > 0.

/**
 * Integer power base^exponent by repeated squaring. 0^0 is 1.
 * Negative exponents are rejected (the result would not be an integer).
 */
export function intPow(base: number, exponent: number): number {
  if (exponent < 0) {
    throw new Error("negative exponent");
  }
  let result = 1;
  let b = base;
  let e = exponent;
  while (e > 0) {
    if (e % 2 === 1) {
      result = result * b;
    }
    b = b * b;
    e = Math.floor(e / 2);
  }
  return result;
}
