// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["a"],["b"],"b"],[[],[],""],[[""],[],""]]
export function inc(xs: string[], ys: string[], s: string): number {
  return xs.concat(ys).indexOf(s) * 2 + (ys.concat(xs).includes(s) ? 1 : 0);
}
