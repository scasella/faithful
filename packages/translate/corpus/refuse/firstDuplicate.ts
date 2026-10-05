// @corpus class=refuse expect=refuse code=map-set
// @corpus note=Set membership uses SameValueZero; the subset has no Set model

/**
 * Returns the first value that appears a second time while scanning left to right.
 *
 * @param xs - the values to scan
 * @returns the first repeated value, or null when every value is distinct (including the empty list)
 */
export function firstDuplicate(xs: number[]): number | null {
  const seen = new Set<number>();
  for (const x of xs) {
    if (seen.has(x)) {
      return x;
    }
    seen.add(x);
  }
  return null;
}
