// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function sb(bs: boolean[]): boolean[] {
  return bs.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
