// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: as r3SortTupleInRecordKeyEq, but the candidate's insertion sort compares the sibling key t[0].
interface E {
  id: number;
  t: [number, number];
}
export function original(es: E[]): number[] {
  return es
    .slice()
    .sort((a, b) => a.t[1] - b.t[1])
    .map((e) => e.id);
}
export function candidate(es: E[]): number[] {
  let out: E[] = [];
  for (const e of es) {
    let p = 0;
    while (p < out.length && out[p].t[0] <= e.t[0]) {
      p = p + 1;
    }
    out = out.slice(0, p).concat([e], out.slice(p));
  }
  return out.map((e) => e.id);
}
