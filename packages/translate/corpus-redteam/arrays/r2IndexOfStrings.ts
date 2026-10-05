// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["","a","","a"],""],[["ab","a"],"a"],[[],""],[["x"],"X"]]
export function idx(xs: string[], s: string): number[] {
  return [xs.indexOf(s), xs.includes(s) ? 1 : 0, xs.slice(1).indexOf(s)];
}
