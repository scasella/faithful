// @redteam area=control status=held
// @redteam-expect ok
// @redteam-inputs [[0],[1],[2],[3],[17],[100],[-5]]
// @redteam-note round 3: two self-call sites, one n - 2 and one Math.floor(n / 2)
export function f(n: number): number { if (n < 2) return n; if (n % 2 === 0) return 1 + f(n - 2); return 1 + f(Math.floor(n / 2)); }
