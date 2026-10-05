// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[1,2,3]],[[]],[[-4]]]
// @redteam-note round 3: `for (let x of xs)` with x reassigned in the body (per-iteration binding)
export function f(xs: number[]): number { let s = 0; for (let x of xs) { x = x * 2; s = s * 10 + x; } return s; }
