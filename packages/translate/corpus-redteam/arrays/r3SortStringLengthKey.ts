// @redteam area=arrays status=held
// @redteam note=completeness finding (sound): comparator a.length - b.length is not a recognized key
// @redteam expect=refuse code=unsupported-syntax
// @redteam inputs=[[["ccc","a","bb","d"]]]
export function sortByLen(xs: string[]): string[] {
  return xs.slice().sort((a, b) => a.length - b.length);
}
