// @redteam status=held
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[1,2]]]
// Round 4 (arrays): `// @ts-ignore` suppresses TS2448 (use before declaration); JavaScript throws ReferenceError (TDZ).
export function r4TsIgnoreTdz(xs: number[]): number {
  // @ts-ignore
  const n = ys.length;
  const ys = xs.slice(1);
  return n;
}
