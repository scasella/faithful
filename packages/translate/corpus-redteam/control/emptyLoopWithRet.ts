// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,5]],[[]]]
export function f(xs: number[]): number { for (const x of xs) { if (x > 2) return x; } return -1; }
