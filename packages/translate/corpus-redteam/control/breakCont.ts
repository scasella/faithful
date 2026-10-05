// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,-2,3,200,4]],[[]]]
export function f(xs: number[]): number { let s = 0; for (const x of xs) { if (x < 0) continue; if (x > 100) break; s = s + x; } return s; }
