// @corpus class=array expect=ok
// @corpus note=Kadane; all-negative input returns the largest single element (not 0); cur + xs[i] is range-checked
// @corpus throws

/**
 * Maximum sum of a non-empty contiguous subarray (Kadane's algorithm).
 *
 * @throws Error("empty input") when `xs` is empty.
 */
export function maxSubarraySum(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error("empty input");
  }
  let best = xs[0];
  let cur = xs[0];
  for (let i = 1; i < xs.length; i++) {
    cur = Math.max(xs[i], cur + xs[i]);
    best = Math.max(best, cur);
  }
  return best;
}
