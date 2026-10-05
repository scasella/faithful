// @corpus class=recursive expect=ok
// @corpus note=Math.abs first, so the recursive argument Math.floor(m / 10) is non-negative and strictly smaller; without the abs, Math.floor(-1 / 10) is -1 and the recursion never ends

/**
 * Sums the decimal digits of an integer, ignoring its sign:
 * digitSum(-4096) is 19.
 */
export function digitSum(n: number): number {
  const m = Math.abs(n);
  if (m < 10) {
    return m;
  }
  return (m % 10) + digitSum(Math.floor(m / 10));
}
