// @redteam area=arrays status=held
// @redteam note=a shrinking while loop on a local copy of a captured array inside a map callback
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],[4,5,6,7]],[[],[]],[[0],[1]]]
export function f(ks: number[], ys: number[]): number[] {
  return ks.map((k) => {
    let rest = ys;
    let s = 0;
    while (rest.length > 0) {
      s = s + rest[0] * k;
      rest = rest.slice(2);
    }
    return s;
  });
}
