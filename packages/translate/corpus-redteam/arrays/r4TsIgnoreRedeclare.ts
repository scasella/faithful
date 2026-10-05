// @redteam status=held
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[1,2,3]]]
// Round 4 (arrays): `// @ts-ignore` suppresses TS2451 (redeclared let); JavaScript rejects the module (SyntaxError).
export function r4TsIgnoreRedeclare(xs: number[]): number {
  let ys = xs.slice(1);
  // @ts-ignore
  let ys = ys.slice(1);
  return ys.length;
}
