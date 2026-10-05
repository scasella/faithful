// @corpus class=string expect=ok
// @corpus note=not String.prototype.trim: strips every code unit <= 32 (including "\u0000" and other controls) but keeps NBSP U+00A0, U+2028 and U+FEFF, which trim() removes. charCodeAt is guarded by start < end through && short-circuit; rangeOk must respect that ordering. Termination measure: end - start.

/**
 * Removes leading and trailing ASCII whitespace and control characters (code units 0..32).
 *
 * @example trimControl("\t  hi there \n") // "hi there"
 * @example trimControl("   ")             // ""
 */
export function trimControl(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 32) {
    start++;
  }
  while (end > start && s.charCodeAt(end - 1) <= 32) {
    end--;
  }
  return s.slice(start, end);
}
