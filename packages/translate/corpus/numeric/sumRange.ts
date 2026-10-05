// @corpus class=numeric expect=refuse code=float
// @corpus note=Gauss's formula: (hi - lo + 1) * (lo + hi) is always even, so the bare / 2 is integer-valued, but bare division is refused (not provably integer-valued). Rewriting with Math.floor(... / 2) would be in subset.

/**
 * Sum of the integers lo, lo + 1, ..., hi (inclusive) in constant time.
 * Returns 0 for an empty range (hi < lo).
 */
export function sumRange(lo: number, hi: number): number {
  if (hi < lo) {
    return 0;
  }
  return ((hi - lo + 1) * (lo + hi)) / 2;
}
