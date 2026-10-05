// @corpus class=refuse expect=refuse code=io
// @corpus note=the returned value is deterministic, but console.log is an observable side effect outside the pure model

/**
 * Prefix sums of a list, logging each intermediate total for debugging.
 *
 * @param xs - the values to accumulate
 * @returns the running totals; empty for an empty list
 */
export function runningTotals(xs: number[]): number[] {
  let out: number[] = [];
  let total = 0;
  for (const x of xs) {
    total = total + x;
    console.log(`running total: ${total}`);
    out = out.concat([total]);
  }
  return out;
}
