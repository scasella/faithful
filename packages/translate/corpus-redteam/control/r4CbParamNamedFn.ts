// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2],2],[[],0]]
// @redteam-note round 4: callback parameter named like the function, self-call outside the callback
export function f(xs: number[], n: number): number { const ys = xs.map((f) => f * 2); if (n <= 0) return ys.length; return ys.length + f(xs, n - 1); }
