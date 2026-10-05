// @redteam area=arrays status=divergence input=[[1,2]] ts={"tag":"fault","detail":"uncaught TypeError: Assignment to constant variable."} lean={"tag":"ok","value":5}
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[1,2]],[[]]]
// Round 4 (arrays): `// @ts-ignore` suppresses the assignment to a for...of `const` loop variable.
export function r4TsIgnoreForOfConstAssign(xs: number[]): number {
  let s = 0;
  for (const x of xs) {
    // @ts-ignore
    x = x + 1;
    s = s + x;
  }
  return s;
}
