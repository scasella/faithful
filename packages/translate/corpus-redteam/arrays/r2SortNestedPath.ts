// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[{"id":"a","p":{"x":2,"y":0}},{"id":"b","p":{"x":1,"y":5}},{"id":"c","p":{"x":2,"y":1}},{"id":"d","p":{"x":1,"y":-1}}]]]
type P = { x: number; y: number };
type R = { id: string; p: P };
export function byX(rs: R[]): string[] {
  return rs.slice().sort((a, b) => a.p.x - b.p.x).map((r) => r.id);
}
