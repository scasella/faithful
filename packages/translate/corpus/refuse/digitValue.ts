// @corpus class=refuse expect=refuse code=nan
// @corpus note=NaN is returned as an ordinary value to signal "not a digit"; the int model has no NaN

/**
 * Numeric value of a single ASCII decimal digit character.
 *
 * @param ch - a one-character string
 * @returns 0..9 for "0".."9", NaN for anything else (including "" and multi-character strings)
 */
export function digitValue(ch: string): number {
  if (ch.length !== 1) {
    return NaN;
  }
  const code = ch.charCodeAt(0);
  if (code < 48 || code > 57) {
    return NaN;
  }
  return code - 48;
}
