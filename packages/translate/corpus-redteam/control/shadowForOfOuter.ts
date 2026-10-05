// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2]],[[]]]
export function f(xs: number[]): number { let x = 5; let s = 0; for (const x of xs) { s = s + x; } return x * 100 + s; }
