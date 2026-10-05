// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3]],[[]]]
export function f(xs: number[]): number { let s = 0; for (const x of xs) { xs = xs.slice(1); s = s * 10 + x + xs.length; } return s + xs.length; }
