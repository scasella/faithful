// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2],3],[[],3],[[1],0],[[9,9,9],1]]
// @redteam-note round 4: guard `xs.length > 0 && n > 0` covering both params
export function f(xs: number[], n: number): number { if (xs.length > 0 && n > 0) return xs[0] + f(xs.slice(1), n - 1); return n; }
