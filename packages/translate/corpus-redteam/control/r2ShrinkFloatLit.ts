// @redteam area=control status=held
// @redteam-expect refuse:float
export function f(xs: number[]): number { let c = 0; while (xs.length > 0.5) { xs = xs.slice(1); c++; } return c; }
