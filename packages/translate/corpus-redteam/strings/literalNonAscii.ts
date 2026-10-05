// @redteam area=strings status=held
// @inputs [["é"],["e"],["ÉCOLE"],[""]]
export function literalNonAscii(s: string): [boolean, boolean, string, boolean] {
  return [s === "é", s < "é", "Ü" + s, `ß${s}ß`.length > 2];
}
