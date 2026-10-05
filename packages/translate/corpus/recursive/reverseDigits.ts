// @corpus class=recursive expect=ok
// @corpus note=tail recursion with an explicit accumulator; the measure is n (Math.floor(n / 10)), not acc, which grows and can leave 2^53 for long inputs with a nonzero starting acc
// @corpus throws

/**
 * Reverses the decimal digits of a non-negative integer, appending them to
 * an accumulator: reverseDigits(1230, 0) is 321, reverseDigits(12, 9) is 921.
 */
export function reverseDigits(n: number, acc: number): number {
  if (n < 0) {
    throw new Error("reverseDigits expects a non-negative integer");
  }
  if (n === 0) {
    return acc;
  }
  return reverseDigits(Math.floor(n / 10), acc * 10 + (n % 10));
}
