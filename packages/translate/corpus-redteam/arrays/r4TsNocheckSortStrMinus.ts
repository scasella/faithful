// @ts-nocheck
// @redteam area=arrays status=divergence input=[[{"s":"b"},{"s":"a"}]] ts={"tag":"ok","value":[{"s":"b"},{"s":"a"}]} lean={"tag":"ok","value":[{"s":"a"},{"s":"b"}]}
// @redteam expect=refuse code=unsupported-syntax|unsupported-type
// @redteam inputs=[[[{"s":"b"},{"s":"a"}]],[[]]]
// Round 4 (arrays): the same comparator under a file-level `// @ts-nocheck` (every semantic diagnostic suppressed).
export function r4TsNocheckSortStrMinus(rs: { s: string }[]): { s: string }[] {
  return rs.slice().sort((a, b) => (a.s < b.s ? a.s - b.s : a.s > b.s ? 1 : 0));
}
