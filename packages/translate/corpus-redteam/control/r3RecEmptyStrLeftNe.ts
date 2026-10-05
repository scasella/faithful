// @redteam area=control status=divergence input=["abc"] ts=ok:3 lean=lean-error (failed to prove termination)
// @redteam-expect ok
// @redteam-inputs [[""],["abc"]]
// @redteam-note round 3: recursion in the then-branch of `"" !== s`. Accepted (the measure finder takes the empty literal on either side and emits the slice hint), but decreasing_by sees `[] ≠ s` / `¬[] = s` and faithful_len_pos only closes `¬ s = []`: the model does not compile. Same function with `s !== ""` compiles (tier proved). Completeness: no false claim, an accepted function with no model.
export function f(s: string): number { if ("" !== s) return 1 + f(s.slice(1)); return 0; }
