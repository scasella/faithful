// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
// @redteam-note bound m grows with i: not a measure
export function f(n: number): number { let m = n; let c = 0; for (let i = 0; i < m; i++) { m = m + 1; c = c + 1; if (c > 10) return c; } return c; }
