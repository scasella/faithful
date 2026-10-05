// @redteam status=held
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[[1,2,3]],[[]]]
// Round 4 (arrays): `// @ts-ignore` suppresses TS2366 (function lacks ending return statement); JavaScript returns
// undefined when the loop finishes without returning.
// @ts-ignore
export function r4TsIgnoreFallOff(xs: number[]): number[] {
  for (const x of xs) {
    if (x > 1) return xs.slice(1);
  }
}
