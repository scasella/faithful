// @redteam area=arrays status=held
// @redteam note=nested tuple and flat triple in one signature
// @redteam expect=ok
// @redteam inputs=[[[1,[2,3]],[4,5,6]],[[0,[0,0]],[1,1,1]]]
export function nestFlat(t: [number, [number, number]], u: [number, number, number]): number[] {
  return [t[0], t[1][0], t[1][1], u[0], u[1], u[2]];
}
