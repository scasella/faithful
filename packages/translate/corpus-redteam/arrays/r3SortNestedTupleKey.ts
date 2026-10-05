// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[["a",[2,1]],["b",[1,9]],["c",[2,0]],["d",[1,1]]]],[[]]]
export function sortNested(ps: Array<[string, [number, number]]>): Array<[string, [number, number]]> {
  return ps.slice().sort((a, b) => b[1][0] - a[1][0]);
}
