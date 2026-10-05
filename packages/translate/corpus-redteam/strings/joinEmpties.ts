// @redteam area=strings status=held
// @inputs [[[]],[[""]],[["",""]],[["","",""]],[["a",""]]]
export function joinEmpties(xs: string[]): string[] {
  return [xs.join(), xs.join(""), xs.join("--")];
}
