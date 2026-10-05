// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[[1],[]]],[[]],[[[1,2],[3]]]]
export function f(xs: number[][]): number[] | undefined { for (const r of xs) { if (r.length === 0) return undefined; } return xs.length > 0 ? xs[0] : []; }
