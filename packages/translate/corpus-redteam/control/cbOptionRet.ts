// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2]],[[]]]
export function f(xs: number[]): number | null { const ys = xs.map((x) => { return x + 1; }); if (ys.length === 0) return null; return ys[0]; }
