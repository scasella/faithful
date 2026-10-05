// @redteam area=arrays status=held
// @redteam note=`xs.slice()!.sort()`
// @redteam expect=ok
// @redteam inputs=[[["b","a"]]]
export function nn(xs: string[]): string[] {
  return xs.slice()!.sort();
}
