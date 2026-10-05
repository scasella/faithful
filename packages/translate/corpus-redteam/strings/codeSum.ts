// @redteam area=strings status=held
// @inputs [[""],["abc"],["\uffff\uffff"],["é"]]
export function codeSum(s: string): number {
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    t = t * 31 + s.charCodeAt(i);
    t = t % 1000000007;
  }
  return t;
}
