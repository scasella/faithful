// @redteam area=arrays status=held
// @redteam expect=refuse code=unsupported-syntax
export function appRow(xss: number[][], row: number[]): number[][] {
  return xss.concat(row);
}
