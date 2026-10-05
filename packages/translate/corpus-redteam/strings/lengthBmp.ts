// @redteam area=strings status=held
// @inputs [[""],["é"],["\uffff\u0800"],["abc"]]
export function lengthBmp(s: string): number[] {
  return [s.length, `${s}${s}`.length, s.split("").length];
}
