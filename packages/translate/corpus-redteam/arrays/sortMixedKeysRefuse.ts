// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
type R = { x: number; y: number };
export function mixed(rs: R[]): R[] {
  return rs.slice().sort((a, b) => (a.x < b.x ? -1 : a.y > b.y ? 1 : 0));
}
