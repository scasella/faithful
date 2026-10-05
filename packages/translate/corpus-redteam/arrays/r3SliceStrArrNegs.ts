// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["a","b","c","d"],-3,-1],[["a"],-5,5],[[],0,-1],[["x","y"],1,1]]
export function sl2(xs: string[], a: number, b: number): string {
  return xs.slice(a, b).join("|") + "/" + xs.slice(-a).join("") + "/" + xs.slice(b - a).length;
}
