// @redteam area=strings status=held
// @inputs [[["a","bb",""]],[[]],[["é","x"]]]
export function reduceStrings(xs: string[]): string {
  return xs.reduce((acc, x, i) => acc + i + ":" + x.charAt(0) + x[0] + ";", "");
}
