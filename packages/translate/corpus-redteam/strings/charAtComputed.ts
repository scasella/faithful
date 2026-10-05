// @redteam area=strings status=held
// @inputs [["abc","b"],["abc","z"],["",""],["abc",""]]
export function charAtComputed(s: string, t: string): string {
  return s.charAt(s.indexOf(t)) + s.charAt(s.indexOf(t) - 1) + s.charAt(s.length - 1);
}
