// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[3,1,2,1,-9007199254740992,9007199254740992]],[[]]]
export function eqZero(xs: number[]): number[] {
  return xs.slice().sort((a, b) => (a === b ? 0 : b - a));
}
