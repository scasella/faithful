// @corpus class=array expect=ok
// @corpus note=array of tuples [number, number]; reduce with an annotated empty-array initial value and concat

/**
 * Flattens a list of pairs into a single list: [[1, 2], [3, 4]] becomes
 * [1, 2, 3, 4].
 */
export function flattenPairs(pairs: [number, number][]): number[] {
  const init: number[] = [];
  return pairs.reduce((acc, p) => acc.concat([p[0], p[1]]), init);
}
