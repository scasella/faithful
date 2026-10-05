// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["b","a","B","","ab","a","é","Z"]],[[]]]
export function sortStrs(ss: string[]): string[] {
  return ss.slice().sort();
}
