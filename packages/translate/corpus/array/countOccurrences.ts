// @corpus class=array expect=ok
// @corpus note=case-insensitive via toLowerCase: the model maps ASCII letters only, so this needs the `ascii` precondition (JS maps e.g. "É" too)

/**
 * Number of entries equal to `target`, ignoring case.
 */
export function countOccurrences(words: string[], target: string): number {
  const needle = target.toLowerCase();
  let count = 0;
  for (const w of words) {
    if (w.toLowerCase() === needle) {
      count += 1;
    }
  }
  return count;
}
