// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[{"max":10,"max_":3}]]
type P = { max: number; max_: number };
export function f(p: P): number { return p.max - p.max_; }
