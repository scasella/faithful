// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2],false],[[1,2],true]]
export function f(xs: number[], b: boolean): number { const i = b ? 0 : 5; return xs[i]; }
