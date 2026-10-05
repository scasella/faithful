// @corpus class=array expect=ok
// @corpus note=nested loops with an early return from the inner loop (no break); returns the lexicographically first pair [i, j], i < j, or null

/**
 * Indices `[i, j]` with `i < j` and `xs[i] + xs[j] === target`, choosing the
 * smallest `i` and then the smallest `j`. Returns null when no pair exists.
 */
export function twoSum(xs: number[], target: number): [number, number] | null {
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[i] + xs[j] === target) {
        return [i, j];
      }
    }
  }
  return null;
}
