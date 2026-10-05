// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[["a",2],["b",1],["c",2],["d",1]]]]
export function bySecond(ps: [string, number][]): string[] {
  return ps.slice().sort((x, y) => x[1] - y[1]).map((p) => p[0]);
}
