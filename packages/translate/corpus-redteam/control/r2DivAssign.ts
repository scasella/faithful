// @redteam area=control status=held
// @redteam-expect refuse:float
export function f(n: number): number { let x = n; x /= 2; return x; }
