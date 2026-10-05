// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 2, stable descending sort by a tuple key vs reversing the ascending sort: equal keys come out in the opposite
// order (stability of the sorting network on tuples).
export function original(ps: [number, number][]): [number, number][] {
  return ps.slice().sort((a, b) => b[0] - a[0]);
}
export function candidate(ps: [number, number][]): [number, number][] {
  const asc = ps.slice().sort((a, b) => a[0] - b[0]);
  let out: [number, number][] = [];
  for (const p of asc) {
    out = [p].concat(out);
  }
  return out;
}
