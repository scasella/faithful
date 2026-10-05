// @redteam area=strings status=held
// @inputs [[[{"k":"b","v":1},{"k":"a","v":2},{"k":"b","v":0},{"k":"é","v":3},{"k":"","v":4}]],[[]]]
export function sortStringField(xs: { k: string; v: number }[]): number[] {
  return xs.slice().sort((a, b) => (a.k === b.k ? 0 : a.k < b.k ? -1 : 1)).map((x) => x.v);
}
