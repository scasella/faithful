// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1}
// Stable sort by key with duplicate keys, against a bucket concatenation (keys lie in [-1, 1] at these bounds).
export function original(xs: { k: number; v: number }[]): { k: number; v: number }[] {
  return xs.slice().sort((a, b) => a.k - b.k);
}
export function candidate(xs: { k: number; v: number }[]): { k: number; v: number }[] {
  return xs.filter((x) => x.k < 0).concat(xs.filter((x) => x.k === 0), xs.filter((x) => x.k > 0));
}
