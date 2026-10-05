// @corpus class=refuse expect=refuse code=dictionary
// @corpus note=a `{}` literal inherits Object.prototype: the word "constructor" yields a string "function Object() { [native code] }1" and "__proto__" is silently dropped; "" splits to [""]

/**
 * Counts how often each space-separated word occurs in a sentence.
 *
 * @param text - the sentence; words are separated by single spaces
 * @returns an object mapping each word to its count
 */
export function wordCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const w of text.split(' ')) {
    const prev = counts[w];
    counts[w] = prev === undefined ? 1 : prev + 1;
  }
  return counts;
}
