// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[0,5,1,6,2,7]],[[9,9,9,9]],[[]],[[3,2,1,0]]]
export function keepAboveIndex(xs: number[]): number[] {
  // the index is the position in the ORIGINAL array, not in the filtered one
  return xs.filter((x, i) => x > i).map((x, i) => x * 10 + i);
}
