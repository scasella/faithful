// @smt-redteam expect=equal bounds={"array":4,"string":1,"int":1} adv=[[[[{"x":9007199254740992},5],[{"x":-9007199254740992},6],[{"x":9007199254740992},7],[{"x":-9007199254740992},8]]]]
// Round 3: three-way comparator on a key path a[0].x (record inside a tuple), vs stable insertion sort.
type P = [{ x: number }, number];
export function original(ps: P[]): number[] {
  return ps
    .slice()
    .sort((a, b) => (a[0].x < b[0].x ? -1 : a[0].x > b[0].x ? 1 : 0))
    .map((p) => p[1]);
}
export function candidate(ps: P[]): number[] {
  let out: P[] = [];
  for (const e of ps) {
    let p = 0;
    while (p < out.length && out[p][0].x <= e[0].x) {
      p = p + 1;
    }
    out = out.slice(0, p).concat([e], out.slice(p));
  }
  return out.map((p) => p[1]);
}
