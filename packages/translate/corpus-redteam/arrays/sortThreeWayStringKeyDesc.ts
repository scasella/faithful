// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[{"n":"b","id":0},{"n":"a","id":1},{"n":"b","id":2},{"n":"B","id":3},{"n":"é","id":4},{"n":"","id":5}]]]
type P = { n: string; id: number };
export function byName(ps: P[]): number[] {
  return ps.slice().sort((a, b) => (a.n < b.n ? 1 : a.n > b.n ? -1 : 0)).map((p) => p.id);
}
