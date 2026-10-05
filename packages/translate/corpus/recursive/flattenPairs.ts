// @corpus class=recursive expect=ok
// @corpus note=structural recursion on pairs.slice(1) with tuple element reads; empty input returns []

/**
 * Flattens a list of coordinate pairs into a single interleaved list:
 * [[1, 2], [3, 4]] becomes [1, 2, 3, 4].
 */
export function flattenPairs(pairs: [number, number][]): number[] {
  if (pairs.length === 0) {
    return [];
  }
  const head = pairs[0];
  return [head[0], head[1]].concat(flattenPairs(pairs.slice(1)));
}
