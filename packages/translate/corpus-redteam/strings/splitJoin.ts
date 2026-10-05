// @redteam area=strings status=held
// @inputs [["",""],["abc",""],["a,b",","],["aaa","aa"],["",","]]
export function splitJoin(s: string, sep: string): string {
  return s.split(sep).join("<" + sep + ">");
}
