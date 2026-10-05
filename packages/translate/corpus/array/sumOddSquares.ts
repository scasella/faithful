// @corpus class=array expect=ok
// @corpus note=`x % 2 === 1` is false for negative odd x because JS % truncates (-3 % 2 === -1): negatives are silently skipped; a Euclidean % would include them

/**
 * Sum of the squares of the odd elements.
 */
export function sumOddSquares(xs: number[]): number {
  return xs
    .filter((x) => x % 2 === 1)
    .map((x) => x * x)
    .reduce((acc, x) => acc + x, 0);
}
