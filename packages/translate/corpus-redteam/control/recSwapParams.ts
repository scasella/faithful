// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this recursion. Recognized: a number parameter n passed as n - k (k >= 1) under a guard like `n > 0` or `n >= c` (or Math.floor
// @redteam-note terminating (n + m decreases) but needs a combined measure: documented gap
export function f(n: number, m: number): number { if (n <= 0 || m <= 0) return 0; return f(m - 1, n - 1) + 1; }
