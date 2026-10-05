// @corpus class=string expect=ok
// @corpus note=reverses UTF-16 code units, not graphemes: "éx" (combining acute) becomes "x́e", moving the accent onto x; astral characters would be split into lone surrogates (outside the bmp model). Empty input returns "".

/**
 * Reverses a string one code unit at a time.
 *
 * @example reverseString("hello") // "olleh"
 * @example reverseString("")      // ""
 */
export function reverseString(s: string): string {
  let out = "";
  for (let i = s.length - 1; i >= 0; i--) {
    out += s.charAt(i);
  }
  return out;
}
