// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["a","b","c"]],[[]],[["","x",""]]]
export function rev(ss: string[]): string {
  return ss.reduce((acc, s) => s + "|" + acc, "");
}
