// @redteam area=arrays status=held
// @redteam note=callback parameters named _ , $ and __ (Lean name hygiene)
// @redteam expect=ok
// @redteam inputs=[[[5,6,7]],[[]]]
export function idxs(xs: number[]): number[] {
  return xs.map((_, i) => i).map(($) => $ * 2).filter((__) => __ > 0);
}
