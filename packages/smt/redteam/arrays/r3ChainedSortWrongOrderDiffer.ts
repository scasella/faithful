// @smt-redteam expect=differ bounds={"array":3,"string":1,"int":1}
// Round 3: the chained sorts in the wrong order give lexicographic order by (p[1], p[0]), not (p[0], p[1]).
type P = [number, number];
export function original(ps: P[]): P[] {
  return ps
    .slice()
    .sort((a, b) => a[0] - b[0])
    .sort((a, b) => a[1] - b[1]);
}
export function candidate(ps: P[]): P[] {
  let out: P[] = [];
  for (const e of ps) {
    let p = 0;
    while (p < out.length && (out[p][0] < e[0] || (out[p][0] === e[0] && out[p][1] <= e[1]))) {
      p = p + 1;
    }
    out = out.slice(0, p).concat([e], out.slice(p));
  }
  return out;
}
