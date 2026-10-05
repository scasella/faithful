// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["a","b","a"],"a",[true,false],0],[[],"",[],0],[["x"],"y",[false],0],[["ab","a"],"a",[true],-0]]
export function find(ss: string[], s: string, bs: boolean[], z: number): number[] {
  const ns: number[] = [0, 1, -1];
  return [ss.indexOf(s), ss.includes(s) ? 1 : 0, bs.indexOf(false), ns.indexOf(-z), ns.includes(z * -1) ? 1 : 0];
}
