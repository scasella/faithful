// @corpus class=string expect=ok
// @corpus note=option-of-record return (null on ""); the record has a field literally named "length" (must not be confused with .length on strings/arrays). Ties go to the smaller character under < (UTF-16 code-unit order: "Z" < "a", "é" > "z"), not localeCompare.

/**
 * Finds the longest run of one repeated character. When several runs are equally long,
 * the run whose character compares smallest wins. Returns null for the empty string.
 *
 * @example longestRun("aabbbcc")  // { char: "b", length: 3 }
 * @example longestRun("bbaa")     // { char: "a", length: 2 }
 * @example longestRun("")         // null
 */
export function longestRun(s: string): { char: string; length: number } | null {
  if (s.length === 0) {
    return null;
  }
  let bestChar = s.charAt(0);
  let bestLen = 1;
  let runStart = 0;
  for (let i = 1; i <= s.length; i++) {
    if (i === s.length || s.charAt(i) !== s.charAt(runStart)) {
      const len = i - runStart;
      const c = s.charAt(runStart);
      if (len > bestLen || (len === bestLen && c < bestChar)) {
        bestChar = c;
        bestLen = len;
      }
      runStart = i;
    }
  }
  return { char: bestChar, length: bestLen };
}
