// @corpus class=numeric expect=ok
// @corpus throws
// @corpus note=The loop computes one value past the answer: fib(78) = 8944394323791464 is in range, but returning it requires b = fib(79) > 2^53 on the last iteration, so rangeOk rejects n = 78 even though the result fits.

/**
 * The n-th Fibonacci number, iteratively: fib(0) = 0, fib(1) = 1.
 */
export function fibonacci(n: number): number {
  if (n < 0) {
    throw new Error("n must be non-negative");
  }
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
}
