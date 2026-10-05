// @redteam area=strings status=held
// @inputs [[""],["z"]]
export function templateEscapes(s: string): string {
  return `a\${b}\`c\\${s}\u{41}\x42
line2`;
}
