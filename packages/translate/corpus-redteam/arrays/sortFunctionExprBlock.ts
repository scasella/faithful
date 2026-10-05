// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[["b",2],["a",2],["c",1]]]]
export function byB(ps: [string, number][]): [string, number][] {
  return ps.map((p) => p).sort(function (x, y) { return y[1] - x[1]; });
}
