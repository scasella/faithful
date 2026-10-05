// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[3],[11],[25],[-2]]
// @redteam-note round 4: two self-calls under different lower bounds (n > 10, n >= 3): minLb is the smaller
export function f(n: number): number { if (n > 10) return 1 + f(n - 2); if (n >= 3) return 2 + f(n - 3); return n; }
