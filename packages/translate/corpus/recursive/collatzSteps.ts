// @corpus class=recursive expect=refuse code=no-termination-measure
// @corpus note=the odd branch recurses on 3 * n + 1, which grows; termination is the open Collatz conjecture, so no measure exists to find

/**
 * Counts the steps the Collatz map takes to reach 1 from n
 * (collatzSteps(6) is 8). Inputs below 2 take zero steps.
 */
export function collatzSteps(n: number): number {
  if (n <= 1) {
    return 0;
  }
  if (n % 2 === 0) {
    return 1 + collatzSteps(Math.floor(n / 2));
  }
  return 1 + collatzSteps(3 * n + 1);
}
