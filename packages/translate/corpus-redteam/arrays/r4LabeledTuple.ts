// @redteam status=held
// @redteam expect=ok
// @redteam inputs=[[[3,"ab"]],[[-1,""]]]
// Round 4 (arrays): labeled tuple elements.
export function r4LabeledTuple(p: [n: number, s: string]): [s: string, n: number] {
  return [p[1] + p[0], p[0] + p[1].length];
}
