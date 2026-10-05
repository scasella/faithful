// @corpus class=array expect=ok
// @corpus note=Option-of-record return (null on empty); range = max - min can leave +-2^53 even when every element is in bounds

/**
 * Summary statistics that need no division: element count, smallest and largest
 * value, and the range (max - min). Returns null for an empty array.
 */
export function spread(
  xs: number[],
): { count: number; min: number; max: number; range: number } | null {
  if (xs.length === 0) {
    return null;
  }
  let lo = xs[0];
  let hi = xs[0];
  for (const x of xs) {
    if (x < lo) {
      lo = x;
    }
    if (x > hi) {
      hi = x;
    }
  }
  return { count: xs.length, min: lo, max: hi, range: hi - lo };
}
