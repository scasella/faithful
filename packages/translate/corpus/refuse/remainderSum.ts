// @corpus class=refuse expect=refuse code=missing-annotation
// @corpus note=no return type annotation (otherwise in subset); JS % is truncated, so remainderSum([-7, 7], 3) === 0 (-1 + 1), and a negative divisor does not change the signs
// @corpus throws

/**
 * Sum of the remainders x % d over a list, using JavaScript's truncated remainder.
 *
 * @param xs - the dividends
 * @param d - the divisor, must be non-zero
 * @returns the sum of x % d; 0 for an empty list
 * @throws Error("division by zero") when d === 0
 */
export function remainderSum(xs: number[], d: number) {
  if (d === 0) {
    throw new Error('division by zero');
  }
  let total = 0;
  for (const x of xs) {
    total = total + (x % d);
  }
  return total;
}
