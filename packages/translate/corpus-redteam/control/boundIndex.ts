// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[[3]],[[]],[[-1]]]
export function f(xs: number[]): number { let c = 0; for (let i = 0; i < xs[0]; i++) { c = c + 1; } return c; }
