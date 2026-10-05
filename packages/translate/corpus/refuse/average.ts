// @corpus class=refuse expect=refuse code=float
// @corpus note=bare `/` is not provably integer-valued ([1, 2] -> 1.5); only Math.floor(a / b) / Math.ceil(a / b) are in the subset
// @corpus throws

/**
 * Arithmetic mean of a list of integers.
 *
 * @param xs - the values to average
 * @returns the mean, which may be fractional
 * @throws Error("average of empty list") when `xs` is empty, instead of returning NaN from 0 / 0
 */
export function average(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error('average of empty list');
  }
  let sum = 0;
  for (const x of xs) {
    sum = sum + x;
  }
  return sum / xs.length;
}
