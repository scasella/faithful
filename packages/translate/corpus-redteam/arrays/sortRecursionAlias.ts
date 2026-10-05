// @redteam area=arrays status=divergence input=[[2,1],1] ts={"tag":"ok","value":[1,2,1,2]} lean={"tag":"ok","value":[1,2,2,1]}
// @redteam note=soundness: lower.ts sort() treats ANY CallExpression receiver as a fresh array; reduce returns its accumulator (the initial value or an element) and a self-call can return a parameter, so sort mutates a live array the model treats as immutable (pre = true on the input)
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[2,1],1],[[3,1,2],2]]
export function sortRec(xs: number[], n: number): number[] {
  if (n <= 0) return xs;
  // for n = 1 the recursive call returns xs itself, which sort mutates
  const s = sortRec(xs, n - 1).sort((a, b) => a - b);
  return s.concat(xs);
}
