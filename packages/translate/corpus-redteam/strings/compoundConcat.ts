// @redteam area=strings status=held
// @inputs [[""],["abc"],["é\u0000"]]
export function compoundConcat(s: string): string {
  let r = "";
  for (let i = 0; i < s.length; i++) {
    r += s.charAt(i);
    r += i;
    r += i > 0;
  }
  return r;
}
