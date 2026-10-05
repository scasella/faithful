// @redteam area=arrays status=divergence input=[[1,2,3]] ts={"tag":"fault","detail":"uncaught TypeError: Assignment to constant variable."} lean={"tag":"ok","value":2}
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[1,2,3]],[[]]]
// Round 4 (arrays): `// @ts-ignore` suppresses TS2588 (assignment to a const). The lowering treats it as an ordinary
// reassignment of the local copy; JavaScript throws TypeError on every call.
export function r4TsIgnoreConstAssign(xs: number[]): number {
  const ys = xs;
  // @ts-ignore
  ys = ys.slice(1);
  return ys.length;
}
