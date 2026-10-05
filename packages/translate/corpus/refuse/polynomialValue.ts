// @corpus class=refuse expect=refuse code=float
// @corpus note=RELABELED (stage 2, corpus conformance): was code=unsupported-library. Math.pow(x, i) is not provably integer-valued (Math.pow(2, -1) is 0.5), which subset v1 lists under floats ("any number not provably integer-valued"); the translator's documented refusal order runs the float scan before library checks.
// @corpus note=Math.pow is not in the subset library; Math.pow(0, 0) === 1, and large powers lose precision past 2^53 instead of failing

/**
 * Evaluates a polynomial with integer coefficients at an integer point.
 *
 * @param coeffs - coefficients, lowest degree first (coeffs[i] multiplies x^i)
 * @param x - the evaluation point
 * @returns the polynomial's value; 0 for an empty coefficient list
 */
export function polynomialValue(coeffs: number[], x: number): number {
  let total = 0;
  for (let i = 0; i < coeffs.length; i++) {
    total = total + coeffs[i] * Math.pow(x, i);
  }
  return total;
}
