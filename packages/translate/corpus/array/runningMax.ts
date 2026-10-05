// @corpus class=array expect=refuse code=mutable-capture
// @corpus note=the map callback reads and reassigns the outer `let best`: a closure over mutable state

/**
 * Running maximum: element `i` of the result is the largest of `xs[0..i]`.
 * Returns an empty array for empty input.
 */
export function runningMax(xs: number[]): number[] {
  if (xs.length === 0) {
    return [];
  }
  let best = xs[0];
  return xs.map((x) => {
    best = Math.max(best, x);
    return best;
  });
}
