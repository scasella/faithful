// @redteam area=strings status=held
// @inputs [["abc",""],["",""],["","a"],["aéb","éb"],["aaa","aa"],["abc","abc"],["ab","abc"]]
export function indexOf1(s: string, sub: string): number {
  return s.indexOf(sub);
}
