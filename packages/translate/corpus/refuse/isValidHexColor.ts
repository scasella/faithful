// @corpus class=refuse expect=refuse code=regex
// @corpus note=the `i` flag and alternation are regex semantics with no model in the subset

/**
 * Validates a CSS hex color of the short (#abc) or long (#aabbcc) form, case-insensitively.
 *
 * @param s - candidate color string
 * @returns true for strings such as "#fff" or "#1A2b3C"
 */
export function isValidHexColor(s: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);
}
