// @corpus class=numeric expect=ok
// @corpus note=Written with a nested ternary instead of Math.sign (not in the subset library list); -0 cannot arise from integer inputs in the model.

/**
 * Sign of an integer: -1, 0 or 1.
 */
export function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}
