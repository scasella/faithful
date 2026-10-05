// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this recursion. Recognized: a number parameter n passed as n - k (k >= 1) under a guard like `n > 0` or `n >= c` (or Math.floor
// @redteam-note terminates (n + m drops by 1 per call; a non-positive m stops the next call) but needs a combined measure: documented gap
export function f(n: number, m: number): number { if (n <= 0) return 0; return f(m, n - 1) + 1; }
