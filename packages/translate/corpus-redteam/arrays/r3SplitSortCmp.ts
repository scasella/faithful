// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[["b,a,c,a,B"],[""],[",,"]]
export function sortWords(s: string): string[] {
  return s.split(",").sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
