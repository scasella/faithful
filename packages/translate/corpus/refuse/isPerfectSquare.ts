// @corpus class=refuse expect=refuse code=float
// @corpus note=Math.sqrt returns a float; it is integer-valued only for perfect squares, so the floor-and-square-back check runs on floats

/**
 * Whether `n` is the square of an integer.
 *
 * @param n - any integer; negative numbers are never perfect squares
 * @returns true when there is an integer r with r * r === n
 */
export function isPerfectSquare(n: number): boolean {
  if (n < 0) {
    return false;
  }
  const r = Math.floor(Math.sqrt(n));
  return r * r === n;
}
