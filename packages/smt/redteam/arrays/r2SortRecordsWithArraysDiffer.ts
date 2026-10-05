// @smt-redteam expect=differ bounds={"array":2,"string":1,"int":1} adv=[[[{"k":3,"xs":[1,2,3,4,5,6]},{"k":-3,"xs":[]},{"k":3,"xs":[7]},{"k":0,"xs":[8,9]},{"k":-3,"xs":[1]},{"k":0,"xs":[]}]]]
// Round 2, sorting records that carry arrays of different lengths (the network swaps whole sequence values):
// ascending vs descending by the key, read through the arrays' lengths.
interface Row {
  k: number;
  xs: number[];
}
export function original(rs: Row[]): number[] {
  return rs
    .slice()
    .sort((a, b) => a.k - b.k)
    .map((r) => r.xs.length * 10 + r.k);
}
export function candidate(rs: Row[]): number[] {
  return rs
    .slice()
    .sort((a, b) => b.k - a.k)
    .map((r) => r.xs.length * 10 + r.k);
}
