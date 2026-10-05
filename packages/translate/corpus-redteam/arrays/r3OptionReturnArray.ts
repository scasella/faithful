// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],2],[[],0],[[5],9]]
export function findPrefix(xs: number[], k: number): number[] | null {
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === k) return xs.slice(0, i);
  }
  return null;
}
