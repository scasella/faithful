// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// Descending stable sort against buckets in descending key order (stability kept).
export function original(xs: { k: number; v: number }[]): { k: number; v: number }[] {
  return xs.slice().sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0));
}
export function candidate(xs: { k: number; v: number }[]): { k: number; v: number }[] {
  return xs.filter((x) => x.k > 0).concat(xs.filter((x) => x.k === 0), xs.filter((x) => x.k < 0));
}
