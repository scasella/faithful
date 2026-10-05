// @corpus class=refuse expect=refuse code=bitwise
// @corpus note=`>> 1` coerces to int32: agrees with Math.floor((lo + hi) / 2) for small sums (including negative odd sums, -3 >> 1 === -2) but wraps once lo + hi >= 2^31

/**
 * Midpoint of two indices, as used in binary search.
 *
 * @param lo - lower index
 * @param hi - upper index
 * @returns (lo + hi) halved, rounded toward negative infinity
 */
export function midpoint(lo: number, hi: number): number {
  return (lo + hi) >> 1;
}
