// @corpus class=recursive expect=refuse code=no-termination-measure
// @corpus note=genuinely diverges on negative input: Math.floor(-1 / 10) is -1, so countDigits(-1) calls itself forever (stack overflow in JS); n is not bounded below on the recursive path

/**
 * Counts the decimal digits of an integer; countDigits(0) is 0 by
 * convention, countDigits(2024) is 4.
 */
export function countDigits(n: number): number {
  if (n === 0) {
    return 0;
  }
  return 1 + countDigits(Math.floor(n / 10));
}
