// @redteam area=strings status=held
// @inputs [["a:b"],[":"],["noc"],[""]]
export function tupleStrings(s: string): [string, number, string] {
  const i = s.indexOf(":");
  return [s.slice(0, i), i, s.slice(i + 1)];
}
