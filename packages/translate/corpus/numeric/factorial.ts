// @corpus class=numeric expect=ok
// @corpus throws
// @corpus note=18! = 6402373705728000 is below 2^53 but 19! is not, so rangeOk must exclude n >= 19 (JS doubles happen to hold 19!..22! exactly and start rounding at 23!; the Int model never rounds). factorial(0) is 1 (empty loop).

/**
 * n! for a non-negative integer n.
 */
export function factorial(n: number): number {
  if (n < 0) {
    throw new Error("factorial of a negative number");
  }
  let result = 1;
  for (let i = 2; i < n + 1; i++) {
    result = result * i;
  }
  return result;
}
