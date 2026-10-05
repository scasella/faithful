// @redteam area=arrays status=divergence input=[[[2,1],[4,3]]] ts={"tag":"ok","value":[2,1,3,4,3,4]} lean={"tag":"ok","value":[2,1,4,3,3,4]}
// @redteam note=soundness: lower.ts sort() treats ANY CallExpression receiver as a fresh array; reduce returns its accumulator (the initial value or an element) and a self-call can return a parameter, so sort mutates a live array the model treats as immutable (pre = true on the input)
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[[2,1],[4,3]]]]
export function sortInner(xss: number[][]): number[] {
  const init: number[] = [];
  // reduce returns the last row (a reference into xss); sort mutates that row
  const last = xss.reduce((acc, r) => r, init).sort((a, b) => a - b);
  return xss.reduce((acc, r) => acc.concat(r), init).concat(last);
}
