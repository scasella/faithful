// @redteam area=strings status=held
// @inputs [[[]],[["a","b"]],[["a","é"]],[["É","a"]]]
export function caseMapCallback(xs: string[]): string[] {
  return xs.map((x) => x.toUpperCase()).filter((x) => x.toLowerCase() !== "b");
}
