// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":1} adv=[[[{"id":9007199254740992,"t":[0,-9007199254740992]},{"id":-9007199254740992,"t":[1,9007199254740992]},{"id":1,"t":[2,-9007199254740992]}]]]
// Round 3: sort records by a key path through a tuple inside a record (a.t[1]) vs a hand-written stable insertion sort.
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
    while (p < out.length && out[p].t[1] <= e.t[1]) {
      p = p + 1;
    }
    out = out.slice(0, p).concat([e], out.slice(p));
  }
  return out.map((e) => e.id);
}
