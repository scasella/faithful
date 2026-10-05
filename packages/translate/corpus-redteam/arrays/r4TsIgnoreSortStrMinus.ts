// @redteam area=arrays status=divergence input=[["b","a"]] ts={"tag":"ok","value":["b","a"]} lean={"tag":"ok","value":["a","b"]}
// @redteam expect=refuse code=unsupported-syntax|unsupported-type
// @redteam inputs=[[["b","a"]],[["10","9","x"]],[[]]]
// Round 4 (arrays): `// @ts-ignore` suppresses TS2362 (string - string). The comparator reader accepts `a - b` on string keys
// when the subtraction is not the top-level expression (`usesMinus` looks only at the top), and models the comparator
// as ascending string order; JavaScript computes "b" - "a" = NaN, which sort treats as 0 (equal), so nothing moves.
export function r4TsIgnoreSortStrMinus(xs: string[]): string[] {
  // @ts-ignore
  return xs.slice().sort((a, b) => (a === b ? 0 : a - b));
}
