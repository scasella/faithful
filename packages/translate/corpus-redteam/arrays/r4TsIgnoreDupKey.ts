// @redteam area=arrays status=divergence input=[1] ts={"tag":"ok","value":[{"a":2}]} lean=lean-error(the model elaborates with an error: #eval aborts because the expression depends on sorry)
// @redteam expect=refuse code=unsupported-syntax|unsupported-type
// @redteam inputs=[[1]]
// Round 4 (arrays): `// @ts-ignore` suppresses TS1117 (duplicate key) and TS2741 (missing field b). JavaScript builds
// [{ a: n + 1 }] (the last duplicate wins, no field b).
export function r4TsIgnoreDupKey(n: number): { a: number; b: number }[] {
  // @ts-ignore
  return [{ a: n, a: n + 1 }];
}
