// @redteam area=arrays status=divergence input=[["b","a"]] ts={"tag":"ok","value":["b","a"]} lean={"tag":"ok","value":["a","b"]}
// @redteam expect=refuse code=unsupported-syntax|unsupported-type
// @redteam inputs=[[["b","a"]],[["a"]]]
// Round 4 (arrays): r4TsIgnoreSortStrMinus with `// @ts-expect-error` instead of `// @ts-ignore`, and the subtraction
// in the inner branch of a three-way conditional.
export function r4TsExpectErrorSortStrMinus(xs: string[]): string[] {
  // @ts-expect-error
  return xs.slice().sort((a, b) => (a < b ? a - b : a === b ? 0 : 1));
}
