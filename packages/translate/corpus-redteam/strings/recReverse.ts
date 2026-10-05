// @redteam area=strings status=held
// @inputs [[""],["a"],["abc"],["héé\uffff"]]
export function recReverse(s: string): string {
  if (s.length === 0) return "";
  return recReverse(s.slice(1)) + s.charAt(0);
}
