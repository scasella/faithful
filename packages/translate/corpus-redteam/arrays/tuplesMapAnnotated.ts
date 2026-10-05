// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[["a",1],["b",-2]]],[[]]]
export function swap(ps: [string, number][]): [number, string][] {
  return ps.map((p): [number, string] => [p[1], p[0] + p.length]);
}
