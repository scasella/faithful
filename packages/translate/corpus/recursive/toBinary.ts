// @corpus class=recursive expect=ok
// @corpus note=integer measure n with Math.floor(n / 2); the bit is chosen by a ternary on n % 2 rather than number-to-string conversion
// @corpus throws

/**
 * Renders a non-negative integer in base 2 without leading zeros
 * (toBinary(0) is "0", toBinary(10) is "1010").
 */
export function toBinary(n: number): string {
  if (n < 0) {
    throw new Error("toBinary expects a non-negative integer");
  }
  if (n < 2) {
    return n === 0 ? "0" : "1";
  }
  const bit = n % 2 === 0 ? "0" : "1";
  return toBinary(Math.floor(n / 2)) + bit;
}
