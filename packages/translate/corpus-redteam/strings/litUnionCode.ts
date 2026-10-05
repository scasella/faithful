// @redteam area=strings status=divergence expect=ok input=["ab",5] ts=ok:false(no-range-violation) lean=ok:true,rangeOk=false
// instrument.ts gates the charCodeAt bounds helper on TypeFlags.StringLike of the receiver's type; a string-literal
// union ("ab" | "cd", accepted as string) has TypeFlags.Union, so the check is not inserted: NaN < 64 is false in JS
// while the instrumented original reports no range violation, and Lean's rangeOk is false (model reads 0).
// @inputs [["ab",5],["ab",-1],["cd",1],["zz",0]]
export function litUnionCode(s: "ab" | "cd", i: number): boolean {
  return s.charCodeAt(i) < 64;
}
