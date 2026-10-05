// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3]],[[]]]
export function f(xs: number[]): number { let from = 0; let from_ = 100; for (const x of xs) { from = from + x; from_ = from_ - 1; } return from * 1000 + from_; }
