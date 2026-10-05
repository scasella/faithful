// @corpus class=refuse expect=refuse code=unsupported-syntax
// @corpus note=array destructuring of a tuple parameter is refused in v1 unless the translator documents a sound encoding; if it does, this file's expected code must be revisited
// @corpus throws

/**
 * Clamps a value into an inclusive range.
 *
 * @param value - the value to clamp
 * @param range - [lo, hi], inclusive bounds
 * @returns lo if value < lo, hi if value > hi, otherwise value
 * @throws Error("empty range") when lo > hi
 */
export function clamp(value: number, range: [number, number]): number {
  const [lo, hi] = range;
  if (lo > hi) {
    throw new Error('empty range');
  }
  return Math.min(Math.max(value, lo), hi);
}
