// @redteam area=strings status=divergence expect=ok input=["ab",5] ts=ok:"undefined!"(no-bounds-violation) lean=ok:"A!",rangeOk=false
// instrument.ts `isIndexable` checks isArrayType || TypeFlags.StringLike; a string-literal union receiver is neither,
// so `s[i]` is not wrapped in the bounds helper.
// @inputs [["ab",5],["ab",-1],["cd",1]]
export function litUnionIndex(s: "ab" | "cd", i: number): string {
  return s[i] + "!";
}
