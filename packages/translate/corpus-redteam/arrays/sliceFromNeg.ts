// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["a","b","c"],-1],[["a","b","c"],-3],[["a","b","c"],-4],[["a","b","c"],3],[["a","b","c"],4],[["a","b","c"],-9007199254740992],[["a","b","c"],9007199254740992],[[],-1]]
export function tail(xs: string[], a: number): string[] {
  return xs.slice(a).concat(xs.slice());
}
