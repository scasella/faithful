// @redteam area=control status=held
// @redteam-expect refuse:float
// @redteam-note round 2: litOf(1e400) would be BigInt(Infinity) (a crash) if the measure finder ran before the literal check
export function f(n: number): number { let c = 0; while (n > 1e400) { n = Math.floor(n / 2); c++; } return c; }
