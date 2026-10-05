// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[3]],[[]]]
export function f(xs: number[]): { a: number } | null { return xs.length > 0 ? { a: xs[0] } : null; }
