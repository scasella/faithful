// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[[1,2,3,4,5,6],3],[[],0],[[-3,3],0]]
export function keep(xs: number[], m: number): number[] {
  return xs.filter((x) => {
    if (m === 0) return false;
    const r = x % m;
    return r === 0 || r === -1;
  });
}
