// @redteam area=strings status=held
// @inputs [[""],["aB"],["aBé"],["éaB"]]
export function asciiRecursion(s: string): string {
  if (s.length === 0) return "";
  return s.charAt(0).toUpperCase() + asciiRecursion(s.slice(1));
}
