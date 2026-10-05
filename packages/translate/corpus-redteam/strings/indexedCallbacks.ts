// @redteam area=strings status=held
// @inputs [[["ab","c",""]],[["abc","abc","abc"]],[[]],[["x"]]]
export function indexedCallbacks(xs: string[]): number[] {
  return xs.filter((x, i) => x.length > i).map((x, i) => x.charCodeAt(i));
}
