// @corpus class=string expect=ok
// @corpus throws
// @corpus note=throws a literal message for count < 0; the loop runs count times even when s and separator are both empty, so the harness must bound count (a 2^53 count is a timeout, i.e. a fault, not a disagreement).

/**
 * Repeats `s` `count` times, putting `separator` between consecutive copies.
 *
 * @throws Error("count must be non-negative") when `count < 0`.
 * @example repeatString("ab", 3, "-") // "ab-ab-ab"
 * @example repeatString("ab", 0, "-") // ""
 */
export function repeatString(s: string, count: number, separator: string): string {
  if (count < 0) {
    throw new Error("count must be non-negative");
  }
  let out = "";
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      out += separator;
    }
    out += s;
  }
  return out;
}
