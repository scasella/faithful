// @corpus class=array expect=ok
// @corpus note=descending loop `i--` from length - 1 down to 0; empty input never enters the loop (start index -1)

/**
 * Returns a new array with the elements in reverse order. The input is not
 * modified.
 */
export function reverseArray(xs: string[]): string[] {
  let out: string[] = [];
  for (let i = xs.length - 1; i >= 0; i--) {
    out = out.concat([xs[i]]);
  }
  return out;
}
