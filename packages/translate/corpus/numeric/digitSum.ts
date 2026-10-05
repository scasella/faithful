// @corpus class=numeric expect=ok
// @corpus note=Negative input is handled via Math.abs first; the loop measure is the non-negative n, which Math.floor(n / 10) strictly decreases while n > 0.

/**
 * Sum of the decimal digits of an integer, ignoring its sign.
 * digitSum(0) is 0, digitSum(-492) is 15.
 */
export function digitSum(value: number): number {
  let n = Math.abs(value);
  let sum = 0;
  while (n > 0) {
    sum = sum + (n % 10);
    n = Math.floor(n / 10);
  }
  return sum;
}
