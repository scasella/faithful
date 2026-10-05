// @corpus class=refuse expect=refuse code=unsupported-syntax
// @corpus note=calls the non-exported helper gcd (calls to other functions are outside subset v1); gcd uses truncated % so negative inputs are handled by Math.abs, and the result is always non-negative

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/**
 * Least common multiple of a list of integers.
 *
 * @param xs - the integers; signs are ignored
 * @returns the non-negative LCM; 1 for an empty list, 0 if any element is 0
 */
export function lcmOfList(xs: number[]): number {
  let acc = 1;
  for (const x of xs) {
    if (x === 0) {
      return 0;
    }
    acc = Math.abs(Math.floor(acc / gcd(acc, x)) * x);
  }
  return acc;
}
