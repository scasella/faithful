// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1} adv=[[[{"s":"￿","v":1},{"s":"\u0000","v":2},{"s":"퟿","v":3},{"s":"","v":4},{"s":"\u0000","v":5},{"s":"","v":6}]]]
// Round 3: sort records by a string field (three-way) vs insertion sort with string <=.
interface E {
  s: string;
  v: number;
}
export function original(es: E[]): number[] {
  return es
    .slice()
    .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))
    .map((e) => e.v);
}
export function candidate(es: E[]): number[] {
  let out: E[] = [];
  for (const e of es) {
    let p = 0;
    while (p < out.length && out[p].s <= e.s) {
      p = p + 1;
    }
    out = out.slice(0, p).concat([e], out.slice(p));
  }
  return out.map((e) => e.v);
}
