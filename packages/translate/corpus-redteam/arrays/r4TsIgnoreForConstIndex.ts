// @redteam area=arrays status=divergence input=[[1,2,3]] ts={"tag":"fault","detail":"uncaught TypeError: Assignment to constant variable."} lean={"tag":"ok","value":6}
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[1,2,3]],[[]]]
// Round 4 (arrays): `// @ts-ignore` suppresses TS2588 on the `i++` of a `const` index loop. JavaScript throws TypeError
// at the first increment (after one iteration); an empty array never reaches it.
export function r4TsIgnoreForConstIndex(xs: number[]): number {
  let s = 0;
  // @ts-ignore
  for (const i = 0; i < xs.length; i++) {
    s = s + xs[i];
  }
  return s;
}
