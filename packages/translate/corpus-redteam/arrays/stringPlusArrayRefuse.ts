// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function show2(xs: string[]): string {
  return "a" + xs;
}
