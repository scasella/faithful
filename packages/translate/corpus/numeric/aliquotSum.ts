// @corpus class=numeric expect=ok
// @corpus note=Empty range when n <= 1 (and for all negative n): the loop body never runs and the result is 0. n % i with i >= 1, so no zero divisor.

/**
 * Aliquot sum: the sum of the proper divisors of n (all positive divisors
 * smaller than n). Perfect numbers satisfy aliquotSum(n) === n.
 * Returns 0 for n <= 1.
 */
export function aliquotSum(n: number): number {
  let sum = 0;
  for (let i = 1; i < n; i++) {
    if (n % i === 0) {
      sum = sum + i;
    }
  }
  return sum;
}
