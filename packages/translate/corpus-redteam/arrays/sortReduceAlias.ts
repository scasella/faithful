// @redteam area=arrays status=divergence input=[[2,1]] ts={"tag":"ok","value":[1,2,1,2]} lean={"tag":"ok","value":[2,1,1,2]}
// @redteam note=soundness: lower.ts sort() treats ANY CallExpression receiver as a fresh array; reduce returns its accumulator (the initial value or an element) and a self-call can return a parameter, so sort mutates a live array the model treats as immutable (pre = true on the input)
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[2,1]],[[3,1,2]]]
export function sortAlias(xs: number[]): number[] {
  // reduce returns its initial value, i.e. xs itself: .sort() then mutates xs in place
  const s = xs.reduce((acc, x) => acc, xs).sort((a, b) => a - b);
  return xs.concat(s);
}
