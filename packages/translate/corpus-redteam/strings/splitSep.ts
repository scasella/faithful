// @redteam area=strings status=held
// @inputs [["",""],["",","],["abc",""],["a,b,,c,",","],[",",","],["aaa","aa"],["aaaa","aa"],["ab","abc"],["abc","abc"],["a\u0000b","\u0000"],["éaé","é"],["xyx","x"]]
export function splitSep(s: string, sep: string): string[] {
  return s.split(sep);
}
