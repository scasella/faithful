// @corpus class=refuse expect=refuse code=generic
// @corpus note=the last chunk is shorter when size does not divide xs.length; concat([slice]) appends one nested array rather than flattening
// @corpus throws

/**
 * Splits a list into consecutive chunks of `size` elements.
 *
 * @param xs - the list to split
 * @param size - chunk length, must be positive
 * @returns the chunks in order; empty for an empty list
 * @throws Error("chunk size must be positive") when size <= 0 (the loop would never advance)
 */
export function chunk<T>(xs: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('chunk size must be positive');
  }
  let out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) {
    out = out.concat([xs.slice(i, i + size)]);
  }
  return out;
}
