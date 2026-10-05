// @corpus class=refuse expect=refuse code=unsupported-library
// @corpus note=RELABELED (stage 2, corpus conformance): was code=non-bmp. String.fromCodePoint is not in the subset v1 library list, whatever its argument (it is BMP-only for code points below 0x10000); the translator reserves non-bmp for string literals with astral characters or lone surrogates. No corpus file now exercises the non-bmp code.
// @corpus note=String.fromCodePoint above 0xFFFF emits surrogate pairs (length 2 per code point); invalid code points throw a RangeError (a non-literal throw)

/**
 * Builds a string from a list of Unicode code points.
 *
 * @param cps - code points in 0..0x10FFFF
 * @returns the concatenated characters; "" for an empty list
 */
export function codePointsToString(cps: number[]): string {
  let out = '';
  for (const cp of cps) {
    out = out + String.fromCodePoint(cp);
  }
  return out;
}
