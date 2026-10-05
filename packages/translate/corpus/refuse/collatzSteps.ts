// @corpus class=refuse expect=refuse code=no-termination-measure
// @corpus note=x = 3x + 1 grows; termination of the Collatz iteration is an open problem, so no measure exists to find; sign-mixed inputs are excluded by the throw
// @corpus throws

/**
 * Number of Collatz steps (n -> n / 2 if even, 3n + 1 if odd) needed to reach 1.
 *
 * @param n - the starting value, must be at least 1
 * @returns the step count; 0 for n === 1
 * @throws Error("n must be positive") when n < 1 (0 and negatives never reach 1)
 */
export function collatzSteps(n: number): number {
  if (n < 1) {
    throw new Error('n must be positive');
  }
  let x = n;
  let steps = 0;
  while (x !== 1) {
    x = x % 2 === 0 ? Math.floor(x / 2) : 3 * x + 1;
    steps = steps + 1;
  }
  return steps;
}
