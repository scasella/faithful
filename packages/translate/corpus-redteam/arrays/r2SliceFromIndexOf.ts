// @redteam area=arrays status=held
// @redteam note=indexOf miss (-1) fed to slice: slice(-1) is the last element
// @redteam expect=ok
// @redteam inputs=[[[1,2,3],9],[[1,2,3],2],[[],1]]
export function tail(xs: number[], x: number): number[] {
  return xs.slice(xs.indexOf(x)).concat(xs.slice(0, xs.indexOf(x)));
}
