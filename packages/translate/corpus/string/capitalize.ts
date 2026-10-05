// @corpus class=string expect=ok
// @corpus note=toUpperCase/toLowerCase (ascii precondition): JS "ß".toUpperCase() is "SS" (length changes) and "ǆ" maps to "Ǆ"; the Lean model only maps ASCII letters. slice(1) on a one-character word is "".

/**
 * Upper-cases the first character of `word` and lower-cases the rest.
 *
 * @example capitalize("hELLO") // "Hello"
 * @example capitalize("")      // ""
 */
export function capitalize(word: string): string {
  if (word.length === 0) {
    return word;
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
