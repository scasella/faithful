// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function pick(t: [number, number], i: number): number {
  return t[i];
}
