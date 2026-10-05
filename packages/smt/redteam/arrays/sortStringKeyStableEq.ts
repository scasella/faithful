// @smt-redteam expect=equal bounds={"array":3,"string":2,"int":1}
// Stable sort of records by a string key (strLt in the network) with duplicate keys: two spellings of the comparator.
// (A bucket candidate for "", "a", "b" is NOT equal: Z3 correctly found a key "" outside that alphabet.)
export function original(xs: { s: string; v: number }[]): { s: string; v: number }[] {
  return xs.slice().sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
}
export function candidate(xs: { s: string; v: number }[]): { s: string; v: number }[] {
  return xs.slice().sort((a, b) => (a.s === b.s ? 0 : b.s <= a.s ? 1 : -1));
}
