// @corpus class=numeric expect=ok
// @corpus throws
// @corpus note=Loop is bounded by maxSteps (range for), so termination does not depend on the Collatz conjecture. 3 * x + 1 can leave 2^53 for large odd x (rangeOk). Throws when n < 1 or when the step budget runs out (including any maxSteps < 1 with n > 1).

/**
 * Number of Collatz steps (n -> n / 2 if even, 3n + 1 if odd) needed to
 * reach 1, giving up after maxSteps steps. collatzSteps(1, k) is 0.
 */
export function collatzSteps(n: number, maxSteps: number): number {
  if (n < 1) {
    throw new Error("n must be a positive integer");
  }
  if (n === 1) {
    return 0;
  }
  let x = n;
  for (let step = 1; step < maxSteps + 1; step++) {
    x = x % 2 === 0 ? Math.floor(x / 2) : 3 * x + 1;
    if (x === 1) {
      return step;
    }
  }
  throw new Error("step limit exceeded");
}
