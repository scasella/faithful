// @corpus class=numeric expect=ok
// @corpus note=Naive double self-recursion on the integer measure n (base case n < 2, so negative n returns n unchanged). Exponential time: generators must keep n small (about 30) or the sandbox reports a timeout fault.

/**
 * The n-th Fibonacci number by the textbook recursive definition.
 */
export function fibRecursive(n: number): number {
  if (n < 2) {
    return n;
  }
  return fibRecursive(n - 1) + fibRecursive(n - 2);
}
