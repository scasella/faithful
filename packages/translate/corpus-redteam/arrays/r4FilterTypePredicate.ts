// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,-2,3]]]
// Round 4 (arrays): filter callback with a type-predicate return annotation.
export function r4FilterTypePredicate(xs: number[]): number[] {
  return xs.filter((x): x is number => x > 0);
}
