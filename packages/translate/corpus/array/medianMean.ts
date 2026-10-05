// @corpus class=array expect=refuse code=float
// @corpus note=the textbook median: even length returns (a + b) / 2, a bare division that is non-integer for [1, 2] (1.5)
// @corpus throws

/**
 * Median of the values. For an even number of elements this is the mean of
 * the two middle elements, so the result may be fractional.
 *
 * @throws Error("median of empty array") when `xs` is empty.
 */
export function medianMean(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error("median of empty array");
  }
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}
