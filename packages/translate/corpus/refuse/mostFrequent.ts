// @corpus class=refuse expect=refuse code=map-set
// @corpus note=ties go to the word that first reaches the winning count, not the word that appears first; the type arguments belong to Map, not to a generic function

/**
 * The most frequent word in a list.
 *
 * @param words - the words to count (compared exactly, case-sensitive)
 * @returns the word with the highest count, or null for an empty list
 */
export function mostFrequent(words: string[]): string | null {
  const counts = new Map<string, number>();
  let best = '';
  let bestCount = 0;
  for (const w of words) {
    const prev = counts.get(w);
    const c = prev === undefined ? 1 : prev + 1;
    counts.set(w, c);
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  return bestCount === 0 ? null : best;
}
