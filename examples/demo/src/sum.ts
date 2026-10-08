// @corpus class=array expect=ok
// @corpus note=reduce with an explicit initial value; the empty array sums to 0, and every partial sum is range-checked

/**
 * Sum of all elements. Returns 0 for an empty array.
 */
export function sum(xs: number[]): number {
  return xs.reduce((acc, x) => acc + x, 0);
}
