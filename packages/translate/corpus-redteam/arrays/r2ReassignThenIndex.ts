// @redteam area=arrays status=held
// @redteam note=the indexed array is reassigned (shrunk) inside the body before it is indexed by the counter
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4,5,6],3],[[1,2,3],2],[[],0],[[5],1]]
export function f(xs: number[], n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    xs = xs.slice(1);
    s = s + xs[i];
  }
  return s;
}
