// @redteam area=arrays status=held
// @redteam note=descending comparator written with >= and a nested equality ternary; stability on equal keys
// @redteam expect=ok
// @redteam inputs=[[[{"k":1,"n":"a"},{"k":3,"n":"b"},{"k":1,"n":"c"},{"k":3,"n":"d"},{"k":2,"n":"e"}]]]
type R = { k: number; n: string };
export function desc(rs: R[]): string {
  return rs
    .slice()
    .sort((a, b) => (a.k >= b.k ? (a.k === b.k ? 0 : -1) : 1))
    .map((r) => r.n)
    .join("");
}
