// @redteam area=strings status=held
// @inputs [["",""],["","a"],["a",""],["ab","abc"],["Z","a"],["é","z"],["\uffff","é"],["a\u0000","a"],["abc","abd"],["B","a"],["ÿ","Ā"]]
export function strCompare(a: string, b: string): boolean[] {
  return [a < b, a <= b, a > b, a >= b, a === b, a !== b];
}
