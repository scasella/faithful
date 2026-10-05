// @corpus class=recursive expect=refuse code=no-termination-measure
// @corpus note=terminates, but only by a lexicographic measure on (m, n) with nested recursion; subset v1 accepts a single structural or integer measure, and neither m nor n decreases on every call
// @corpus throws

/**
 * The two-argument Ackermann-Peter function, limited to m <= 3 so that
 * results stay small enough to compute.
 */
export function ackermann(m: number, n: number): number {
  if (m < 0 || n < 0) {
    throw new Error("arguments must be non-negative");
  }
  if (m > 3) {
    throw new Error("m is too large");
  }
  if (m === 0) {
    return n + 1;
  }
  if (n === 0) {
    return ackermann(m - 1, 1);
  }
  return ackermann(m - 1, ackermann(m, n - 1));
}
