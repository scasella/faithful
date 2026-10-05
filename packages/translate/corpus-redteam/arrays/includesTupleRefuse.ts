// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function hasPair(ps: [number, number][], p: [number, number]): boolean {
  return ps.includes(p);
}
