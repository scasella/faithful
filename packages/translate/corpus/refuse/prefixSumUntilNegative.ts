// @corpus class=refuse expect=ok
// @corpus note=RELABELED (stage 2, corpus conformance): was expect=refuse code=unsupported-syntax. Subset v1 refuses break/continue "unless the agent building the translator documents a sound encoding"; packages/translate/NOTES.md ("Control flow encoding (and why break/continue are sound)") documents one, and this file's own note asked for the revisit.
// @corpus note=`break` is refused in v1 unless the translator documents a sound encoding; if it does, this file's expected code must be revisited

/**
 * Sums the leading run of non-negative values, stopping at the first negative one.
 *
 * @param xs - the values to scan
 * @returns the sum of the elements before the first negative value; 0 for an empty list
 */
export function prefixSumUntilNegative(xs: number[]): number {
  let total = 0;
  for (const x of xs) {
    if (x < 0) {
      break;
    }
    total = total + x;
  }
  return total;
}
