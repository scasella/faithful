// @redteam area=strings status=held
// @inputs [[""],["aBc"],["@[`{"],["É"],["ß"],["İ"],["\u007f"],["ǅ"],["ABCxyz09_"]]
export function caseMap(s: string): string[] {
  return [s.toLowerCase(), s.toUpperCase()];
}
