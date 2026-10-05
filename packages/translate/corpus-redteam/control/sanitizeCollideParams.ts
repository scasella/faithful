// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[10,3],[0,1]]
export function f(max: number, max_: number): number { return max - max_; }
