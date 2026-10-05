// @smt-redteam expect=equal bounds={"array":3,"string":1,"int":2} adv=[[[1,2,3],4],[[],0],[[9007199254740992],9007199254740992]]
// Round 3: the original reads xs[-1] (a bounds violation, outside the model) when v is absent; where it stays inside
// the model it returns v. Under the claim's semantics (inputs where the original leaves the model are excluded) the
// pair is equal.
export function original(xs: number[], v: number): number {
  return xs[xs.indexOf(v)];
}
export function candidate(xs: number[], v: number): number {
  return v;
}
