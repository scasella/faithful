// @corpus class=numeric expect=refuse code=unsupported-syntax
// @corpus note=lcm calls a separate helper function (gcd); calls to other functions are outside subset v1 even when the helper is pure and in the same file.

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/**
 * Least common multiple of two integers. lcm(0, x) is 0.
 * Divides before multiplying to keep the intermediate small.
 */
export function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return Math.abs(Math.floor(a / gcd(a, b)) * b);
}
