// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[["b","a","c","a","B",""]]]
export function srt(xs: string[]): string[] {
  return xs.slice().sort((a, b) => (a !== b ? (a < b ? -1 : 1) : 0));
}
