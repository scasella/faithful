// @redteam area=strings status=held
// @inputs [[""],["z"]]
export function templateCrlf(s: string): number[] {
  const t = `a
bc${s}`;
  return [t.length, t.charCodeAt(1), t.charCodeAt(3)];
}
