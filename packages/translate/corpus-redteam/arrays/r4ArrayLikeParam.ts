// @redteam status=held
// @redteam expect=refuse code=dictionary|unsupported-type
// @redteam inputs=[[[1,2]]]
// Round 4 (arrays): ArrayLike<number> parameter.
export function r4ArrayLikeParam(xs: ArrayLike<number>): number {
  return xs.length;
}
