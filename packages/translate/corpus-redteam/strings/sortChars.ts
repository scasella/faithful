// @redteam area=strings status=held
// @inputs [[""],["dcba"],["bAaB"],["é\uffffzA\u0000"],["ba,ab,a,"]]
export function sortChars(s: string): string[] {
  return [s.split("").sort().join(""), s.split(",").sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).join("|")];
}
