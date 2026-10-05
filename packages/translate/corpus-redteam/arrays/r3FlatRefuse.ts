// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-library
export function flatIt(xss: number[][]): number[] {
  return xss.flat();
}
