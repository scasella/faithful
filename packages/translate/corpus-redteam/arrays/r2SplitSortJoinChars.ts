// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[["héllo wörld"],[""],["ba"],["￿éaĀ"]]
export function letters(s: string): string {
  return s.split("").sort().join("");
}
