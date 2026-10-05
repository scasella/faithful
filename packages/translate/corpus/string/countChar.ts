// @corpus class=string expect=ok
// @corpus throws
// @corpus note=throws a literal message unless ch is exactly one UTF-16 code unit (so "" and "ab" throw); comparison is exact, so "é" precomposed (U+00E9) and "é" never match each other.

/**
 * Counts how many times the single character `ch` occurs in `s` (case-sensitive).
 *
 * @throws Error("ch must be exactly one character") when `ch.length !== 1`.
 * @example countChar("banana", "a") // 3
 * @example countChar("", "a")       // 0
 */
export function countChar(s: string, ch: string): number {
  if (ch.length !== 1) {
    throw new Error("ch must be exactly one character");
  }
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charAt(i) === ch) {
      count++;
    }
  }
  return count;
}
