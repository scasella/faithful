// @corpus class=recursive expect=ok
// @corpus note=naive exponential recursion on n-1 and n-2; large n is slow in both JS and Lean #eval, so generators must keep n small
// @corpus throws

/**
 * Returns the n-th Fibonacci number (fibonacci(0) = 0, fibonacci(1) = 1),
 * computed with the textbook doubly recursive definition.
 */
export function fibonacci(n: number): number {
  if (n < 0) {
    throw new Error("n must be non-negative");
  }
  if (n < 2) {
    return n;
  }
  return fibonacci(n - 1) + fibonacci(n - 2);
}
