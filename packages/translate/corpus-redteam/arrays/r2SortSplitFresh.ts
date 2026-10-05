// @redteam area=arrays status=held
// @redteam expect=ok
// @redteam inputs=[[""],["b,a,,c"],[",,"],["z"]]
export function srt(s: string): string {
  return s.split(",").sort().join("|");
}
