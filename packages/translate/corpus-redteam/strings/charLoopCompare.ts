// @redteam area=strings status=held
// @inputs [["hello world"],[""],["AzÉé"],["a b"]]
export function charLoopCompare(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= "a" && c <= "z") out = out + c;
    else if (c === " ") out = out + "_";
    else out = out + s.charCodeAt(i);
  }
  return out;
}
