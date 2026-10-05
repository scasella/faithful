// @redteam area=arrays status=held
// @redteam note=record with integer-like keys "1", "0" (JS orders them numerically in JSON output)
// @redteam expect=ok
// @redteam inputs=[[{"1":"b","0":2}],[{"1":"","0":-1}]]
type R = { "1": string; "0": number };
export function numKeys(r: R): R[] {
  return [r, { "1": r["1"] + "x", "0": r["0"] + 1 }];
}
