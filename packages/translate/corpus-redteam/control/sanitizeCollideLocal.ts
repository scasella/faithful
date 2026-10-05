// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[1],[0]]
export function f(n: number): number { const match = n + 1; const match_ = n * 10; return match - match_; }
