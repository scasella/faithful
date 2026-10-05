// @corpus class=string expect=refuse code=regex
// @corpus note=the regex literal is the only construct outside subset v1 and is the first thing reached (the receiver of .test), so the refusal reason should be regex rather than unsupported-library.

/**
 * Returns true when `s` is a URL slug: lowercase ASCII letters and digits in groups
 * separated by single hyphens, with no leading or trailing hyphen.
 *
 * @example isSlug("hello-world-2") // true
 * @example isSlug("Hello--world")  // false
 */
export function isSlug(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}
