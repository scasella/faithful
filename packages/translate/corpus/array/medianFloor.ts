// @corpus class=array expect=ok
// @corpus note=even length averages the two middle values with Math.floor (Int.fdiv): for [-3, 0] the result is -2, not -1 (truncation would give -1); a - b comparator can leave +-2^53
// @corpus throws

/**
 * Median of the values, rounded down when the array has even length
 * (the mean of the two middle elements, floored). The input is not modified.
 *
 * @throws Error("median of empty array") when `xs` is empty.
 */
export function medianFloor(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error("median of empty array");
  }
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}
