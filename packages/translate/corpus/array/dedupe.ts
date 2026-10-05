// @corpus class=array expect=ok
// @corpus note=keeps the first occurrence and the original order; includes on strings is exact code-unit equality (no case folding)

/**
 * Removes duplicate strings, keeping the first occurrence of each and
 * preserving order. Comparison is exact (case-sensitive).
 */
export function dedupe(words: string[]): string[] {
  let out: string[] = [];
  for (const w of words) {
    if (!out.includes(w)) {
      out = out.concat([w]);
    }
  }
  return out;
}
