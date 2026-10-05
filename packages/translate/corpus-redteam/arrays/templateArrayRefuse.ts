// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function show(xs: number[]): string {
  return `${xs}`;
}
