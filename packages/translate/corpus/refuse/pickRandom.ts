// @corpus class=refuse expect=refuse code=random
// @corpus note=nondeterministic by construction; the float product with Math.random() is inherent to the random construct, which is the reason for refusal
// @corpus throws

/**
 * Picks a uniformly random element of a non-empty list.
 *
 * @param xs - the candidates
 * @returns one element of `xs`
 * @throws Error("cannot pick from an empty list") when `xs` is empty
 */
export function pickRandom(xs: string[]): string {
  if (xs.length === 0) {
    throw new Error('cannot pick from an empty list');
  }
  return xs[Math.floor(Math.random() * xs.length)];
}
