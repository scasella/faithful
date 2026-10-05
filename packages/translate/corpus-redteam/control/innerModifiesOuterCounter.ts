// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
// @redteam-note inner loop decrements the outer counter: non-terminating without the c guard; must be refused
export function f(n: number): number { let c = 0; let i = 0; while (i < n) { i = i + 1; for (let j = 0; j < 2; j++) { i = i - 1; } c = c + 1; if (c > 20) return -1; } return c; }
