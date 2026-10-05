// @corpus class=numeric expect=ok
// @corpus throws
// @corpus note=lo === hi is allowed and pins the result; lo > hi throws rather than silently returning hi (which is what Math.min(Math.max(...)) alone would do).

/**
 * Restricts value to the closed interval [lo, hi].
 */
export function clamp(value: number, lo: number, hi: number): number {
  if (lo > hi) {
    throw new Error("clamp: lower bound exceeds upper bound");
  }
  return Math.min(Math.max(value, lo), hi);
}
