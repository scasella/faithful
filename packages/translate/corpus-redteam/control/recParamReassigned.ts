// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this recursion. Recognized: a number parameter n passed as n - k (k >= 1) under a guard like `n > 0` or `n >= c` (or Math.floor
export function f(n: number): number { if (n <= 0) return 0; if (n > 5) { n = n + 10; } return 1 + f(n - 1); }
