// @redteam area=strings status=held
// @inputs [["key=value","="],["novalue","="],["",""],["a==b","=="],["=x","="]]
export function optionSlice(s: string, sep: string): string | null {
  const i = s.indexOf(sep);
  if (i < 0) return null;
  return s.slice(i + sep.length);
}
