// @redteam area=control status=held
// @redteam-expect refuse:float
export function f(n: number): number { let c = 0; while (n > 0.5) { n = Math.floor(n / 2); c++; } return c; }
