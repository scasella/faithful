// @redteam area=arrays status=held
// @redteam note=nested tuple [number, [number, number]] vs a flat triple (both are right-nested products in Lean)
// @redteam expect=ok
// @redteam inputs=[[[1,[2,3]]],[[-1,[0,9007199254740992]]]]
export function nest(t: [number, [number, number]]): [number, [number, number]] {
  return [t[1][0], [t[0], t[1][1]]];
}
