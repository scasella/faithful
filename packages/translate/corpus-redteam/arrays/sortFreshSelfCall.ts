// @redteam area=arrays status=held
// @redteam note=self-call receiver that is always a fresh array: JS and model agree (a fix must not need to refuse every self-call receiver)
// @redteam expect=ok
// @redteam inputs=[[[2,1],1],[[3,1,2],2],[[],0]]
export function sortRecFresh(xs: number[], n: number): number[] {
  if (n <= 0) return xs.slice();
  const s = sortRecFresh(xs, n - 1).sort((a, b) => a - b);
  return s.concat(xs);
}
