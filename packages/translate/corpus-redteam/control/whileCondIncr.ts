// @redteam area=control status=held
// @redteam-expect refuse:no-termination-measure
// @redteam-note refused: no termination measure found for this loop. Recognized: for...of; `i < E` / `i <= E` with i++ or i += k (or the mirror image counting down) in the incrementor o
export function f(n: number): number { let i = 0; let c = 0; while (i++ < n) { c = c + 2; } return c; }
