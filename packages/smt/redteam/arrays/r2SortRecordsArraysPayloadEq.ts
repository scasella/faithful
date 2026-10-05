// @smt-redteam expect=equal bounds={"array":2,"string":1,"int":1} adv=[[[{"k":3,"xs":[1,2,3,4,5,6]},{"k":-3,"xs":[]},{"k":3,"xs":[7]},{"k":0,"xs":[8,9]},{"k":-3,"xs":[1]},{"k":0,"xs":[]}]]]
// Round 2, sort records that carry arrays by an int key, then concatenate their arrays: vs filter buckets (keys in
// [-1, 1] at the brute-force bounds; the adv input uses wider keys, which only the concrete check reads).
interface Row {
  k: number;
  xs: number[];
}
export function original(rs: Row[]): number[] {
  const s = rs.slice().sort((a, b) => a.k - b.k);
  let out: number[] = [];
  for (const r of s) {
    out = out.concat(r.xs);
  }
  return out;
}
export function candidate(rs: Row[]): number[] {
  const s = rs.filter((r) => r.k < 0).concat(rs.filter((r) => r.k === 0), rs.filter((r) => r.k > 0));
  return s.reduce((acc, r) => acc.concat(r.xs), rs.slice(0, 0).map((r) => r.k));
}
