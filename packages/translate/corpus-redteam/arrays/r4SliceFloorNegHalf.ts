// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4,5]],[[]],[[1]]]
// Round 4 (arrays): slice with negative floor/ceil-division indices.
export function r4SliceFloorNegHalf(xs: number[]): number[] {
  return xs.slice(Math.floor(-xs.length / 2), Math.ceil(xs.length / 3) - xs.length);
}
