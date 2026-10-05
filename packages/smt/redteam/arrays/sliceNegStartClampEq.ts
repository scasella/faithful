// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":5}
// @smt-redteam adv=[[[1,2,3],-9007199254740992],[[1,2,3],9007199254740992],[[],-1],[[5],-1],[[5,6],-3]]
// slice with a symbolic negative start below -length clamps to 0 (seq.ts slice, general path / relIndex).
export function original(xs: number[], a: number): number[] {
  return xs.slice(a);
}
export function candidate(xs: number[], a: number): number[] {
  return xs.slice(Math.max(a, -xs.length));
}
