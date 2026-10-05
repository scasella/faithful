// @redteam area=strings status=held
// @inputs [["é"],["x"],["É!"],["ab"]]
export function asciiAfterThrow(s: string): string {
  if (s.length === 1) throw new Error("one");
  return s.toUpperCase();
}
