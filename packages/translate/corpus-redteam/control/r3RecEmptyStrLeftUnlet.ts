// @redteam area=control status=divergence input=["abc"] ts=ok:3 lean=lean-error (failed to prove termination)
// @redteam-expect ok
// @redteam-inputs [[""],["abc"]]
// @redteam-note round 3: let-bound guard `const e = "" === s` (the faithful_unlet path). Accepted (the measure finder takes the empty literal on either side and emits the slice hint), but decreasing_by sees `[] ≠ s` / `¬[] = s` and faithful_len_pos only closes `¬ s = []`: the model does not compile. Same function with `s !== ""` compiles (tier proved). Completeness: no false claim, an accepted function with no model.
export function f(s: string): number { const e = "" === s; if (e) return 0; return 1 + f(s.slice(1)); }
