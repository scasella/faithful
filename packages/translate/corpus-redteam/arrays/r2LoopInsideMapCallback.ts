// @redteam area=arrays status=held
// @redteam note=a counting loop inside a map callback block, bounded by the callback parameter and reading a captured array
// @redteam expect=ok
// @redteam inputs=[[[3,0,-1,5],[1,2,3,4,5,6]],[[],[1]]]
export function prefix(ns: number[], ys: number[]): number[] {
  return ns.map((n) => {
    let s = 0;
    for (let i = 0; i < n && i < ys.length; i++) {
      s = s + ys[i];
    }
    return s;
  });
}
