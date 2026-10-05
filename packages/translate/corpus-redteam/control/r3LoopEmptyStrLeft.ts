// @redteam area=control status=divergence input=["abc"] ts=ok:3 lean=lean-error (failed to prove termination; hypothesis [] ≠ s)
// @redteam-expect ok
// @redteam-inputs [[""],["abc"]]
// @redteam-note round 3: loop `while ("" !== s)` with s = s.slice(1). Accepted (the measure finder takes the empty literal on either side and emits the slice hint), but decreasing_by sees `[] ≠ s` / `¬[] = s` and faithful_len_pos only closes `¬ s = []`: the model does not compile. Same function with `s !== ""` compiles (tier proved). Completeness: no false claim, an accepted function with no model.
export function f(s: string): number { let c = 0; while ("" !== s) { c++; s = s.slice(1); } return c; }
