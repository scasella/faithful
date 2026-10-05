// @corpus class=array expect=ok
// @corpus note=output has length xs.length + 1 and starts with 0; compound assignment `+=` on a let accumulator

/**
 * Prefix sums: `out[i]` is the sum of the first `i` elements, so
 * `out[j] - out[i]` is the sum of `xs.slice(i, j)`. The result always has
 * one more element than the input and starts with 0.
 */
export function prefixSums(xs: number[]): number[] {
  let acc = 0;
  let out: number[] = [0];
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i];
    out = out.concat([acc]);
  }
  return out;
}
