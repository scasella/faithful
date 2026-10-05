// @corpus class=array expect=ok
// @corpus note=throw plus Option return (Except String (Option Int)); k > length is null, k <= 0 throws; slice windows recomputed each step
// @corpus throws

/**
 * Largest sum of any `k` consecutive elements.
 * Returns null when the array is shorter than `k`.
 *
 * @throws Error("window size must be positive") when `k <= 0`.
 */
export function maxWindowSum(xs: number[], k: number): number | null {
  if (k <= 0) {
    throw new Error("window size must be positive");
  }
  if (k > xs.length) {
    return null;
  }
  let best = xs.slice(0, k).reduce((acc, x) => acc + x, 0);
  for (let i = 1; i <= xs.length - k; i++) {
    const s = xs.slice(i, i + k).reduce((acc, x) => acc + x, 0);
    if (s > best) {
      best = s;
    }
  }
  return best;
}
