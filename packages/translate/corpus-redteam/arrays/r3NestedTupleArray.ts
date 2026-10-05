// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[[1,[2,"a"]],[3,[4,"b"]]]],[[]]]
export function nestArr(ps: Array<[number, [number, string]]>): Array<[string, [number, number]]> {
  return ps.map((p): [string, [number, number]] => [p[1][1], [p[1][0], p[0]]]);
}
